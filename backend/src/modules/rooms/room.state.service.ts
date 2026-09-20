import { redis } from "../../db/redis";
import { redisKeys } from "../../config/constants";
import { RoomModel, ROOM_STATUS } from "../../models/room.model";
import { ParticipantSessionModel, PARTICIPANT_ROLE, type ParticipantRole } from "../../models/participantSession.model";
import { AppError } from "../../utils/AppError";

export type LeaveReason = "rest" | "socket" | "disconnect" | "livekit";

export async function getParticipantIds(roomId: string): Promise<string[]> {
  return redis.smembers(redisKeys.roomParticipants(roomId));
}

export async function getParticipantCount(roomId: string): Promise<number> {
  return redis.scard(redisKeys.roomParticipants(roomId));
}

/** Pipelined SCARD per room — used by the room-list endpoint to avoid N round trips. */
export async function getParticipantCounts(roomIds: string[]): Promise<Record<string, number>> {
  if (roomIds.length === 0) return {};

  const pipeline = redis.pipeline();
  for (const roomId of roomIds) pipeline.scard(redisKeys.roomParticipants(roomId));
  const results = await pipeline.exec();

  const counts: Record<string, number> = {};
  roomIds.forEach((roomId, index) => {
    counts[roomId] = Number(results?.[index]?.[1] ?? 0);
  });
  return counts;
}

export async function join(params: {
  roomId: string;
  userId: string;
  role: ParticipantRole;
}): Promise<{ joined: boolean; participantCount: number }> {
  const { roomId, userId, role } = params;

  const room = await RoomModel.findById(roomId);
  if (!room) throw new AppError("ROOM_NOT_FOUND", "Room not found", 404);
  if (room.status === ROOM_STATUS.ENDED) {
    throw new AppError("ROOM_ENDED", "This room has ended", 409);
  }

  const participantsKey = redisKeys.roomParticipants(roomId);
  const currentCount = await redis.scard(participantsKey);
  if (currentCount >= room.maxParticipants) {
    // Re-joining an existing member is always allowed even at capacity.
    const alreadyMember = await redis.sismember(participantsKey, userId);
    if (!alreadyMember) {
      throw new AppError("ROOM_FULL", "This room is at capacity", 409);
    }
  }

  // The atomic write IS the concurrency guard: SADD returns 1 only for the
  // caller that actually added the member. A second concurrent join for the
  // same user returns 0 and is a no-op from here on.
  const added = await redis.sadd(participantsKey, userId);
  const participantCount = await redis.scard(participantsKey);

  if (added === 1) {
    // Racing with a duplicate join, the partial unique index on
    // ParticipantSession is the backstop if the SADD guard above is ever
    // bypassed (e.g. a future caller forgets it) — upsert defensively.
    await ParticipantSessionModel.findOneAndUpdate(
      { roomId, userId, active: true },
      { $setOnInsert: { roomId, userId, role, active: true, joinedAt: new Date() } },
      { upsert: true },
    );
  }

  return { joined: added === 1, participantCount };
}

export async function leave(params: {
  roomId: string;
  userId: string;
  reason: LeaveReason;
}): Promise<{ left: boolean; participantCount: number; roomEnded: boolean }> {
  const { roomId, userId, reason } = params;
  void reason; // logging/metrics only, never branched on

  const participantsKey = redisKeys.roomParticipants(roomId);

  // SREM's return value is the lock: it removes the member and returns 1 for
  // exactly one caller, even under concurrent REST-leave + socket-disconnect
  // calls for the same user. Every other concurrent caller sees 0 and stops
  // here — no distributed lock, no Mongo transaction.
  const removed = await redis.srem(participantsKey, userId);
  if (removed === 0) {
    const participantCount = await redis.scard(participantsKey);
    return { left: false, participantCount, roomEnded: false };
  }

  const session = await ParticipantSessionModel.findOneAndUpdate(
    { roomId, userId, active: true },
    { active: false, leftAt: new Date() },
    { new: false }, // read the pre-update doc so we can compute duration below
  );

  if (session) {
    const durationSec = Math.max(0, Math.round((Date.now() - session.joinedAt.getTime()) / 1000));
    await ParticipantSessionModel.updateOne({ _id: session._id }, { durationSec });
  }

  const participantCount = await redis.scard(participantsKey);

  let roomEnded = false;
  if (session?.role === PARTICIPANT_ROLE.HOST) {
    const result = await RoomModel.updateOne(
      { _id: roomId, status: ROOM_STATUS.LIVE },
      { status: ROOM_STATUS.ENDED, endedAt: new Date() },
    );
    roomEnded = result.modifiedCount === 1;
  }

  // The host leaving ends the room, but everyone else in it is still sitting
  // in the Redis set and holding an open ParticipantSession. Converge them
  // now rather than waiting for each of them to independently disconnect --
  // a REST-only participant never will.
  if (roomEnded) {
    const remainingUserIds = await redis.smembers(participantsKey);
    if (remainingUserIds.length > 0) {
      await redis.del(participantsKey);
      const now = new Date();
      const remainingSessions = await ParticipantSessionModel.find({
        roomId,
        userId: { $in: remainingUserIds },
        active: true,
      });
      await Promise.all(
        remainingSessions.map((remainingSession) => {
          const durationSec = Math.max(
            0,
            Math.round((now.getTime() - remainingSession.joinedAt.getTime()) / 1000),
          );
          return ParticipantSessionModel.updateOne(
            { _id: remainingSession._id },
            { active: false, leftAt: now, durationSec },
          );
        }),
      );
    }
  }

  return { left: true, participantCount, roomEnded };
}
