import type { Request, Response } from "express";
import { Types } from "mongoose";
import { RoomModel, ROOM_STATUS, type RoomDocument } from "../../models/room.model";
import { ParticipantSessionModel } from "../../models/participantSession.model";
import { AppError } from "../../utils/AppError";
import { ok } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { parsedBody } from "../../middleware/validate.middleware";
import type { WebhookEvent } from "livekit-server-sdk";
import { generateToken, verifyWebhookEvent } from "./livekit.service";
import type { TokenRequestInput } from "./livekit.schema";
import { redis } from "../../db/redis";
import { redisKeys, WEBHOOK_DEDUPE_TTL_SECONDS } from "../../config/constants";
import { leave } from "../rooms/room.state.service";
import { logger } from "../../utils/logger";

/**
 * Resolves a LiveKit `roomName` string back to its MongoDB Room document.
 * Rooms are created in LiveKit with the Mongo `_id` as the room name, so an
 * ObjectId-shaped input is tried first; a bare `findOne({ name })` fallback
 * covers any caller that still passes the human-readable name. A `findById`
 * failure (a genuine DB error, not just "not found") is allowed to propagate
 * rather than being swallowed -- silently falling through to the name lookup
 * on a connectivity failure would be a bug in security-relevant room
 * resolution, not a convenience.
 */
async function findRoomByIdOrName(roomNameOrId: string): Promise<RoomDocument | null> {
  if (Types.ObjectId.isValid(roomNameOrId)) {
    const byId = await RoomModel.findById(roomNameOrId);
    if (byId) return byId;
  }
  return RoomModel.findOne({ name: roomNameOrId });
}

export const issueToken = asyncHandler(async (req: Request, res: Response) => {
  const input = parsedBody<TokenRequestInput>(req);
  const authenticatedUserId = req.user!.id;

  // The identity-spoofing guard: a caller-supplied userId that disagrees
  // with the verified JWT is rejected outright, regardless of the brief's
  // example request shape carrying userId for compatibility.
  if (input.userId !== authenticatedUserId) {
    throw new AppError("IDENTITY_MISMATCH", "userId does not match the authenticated user", 403);
  }

  const room = await findRoomByIdOrName(input.roomName);
  if (!room) throw new AppError("ROOM_NOT_FOUND", "Room not found", 404);

  // Every other room entry point (REST join, socket room:join) rejects an
  // ended room with 409 ROOM_ENDED; token issuance must not be the one path
  // that hands out a fully-privileged LiveKit token for a room that's over.
  if (room.status === ROOM_STATUS.ENDED) {
    throw new AppError("ROOM_ENDED", "This room has ended", 409);
  }

  // Role is derived from room.host, never trusted from the request body.
  const role = String(room.host) === authenticatedUserId ? "host" : "participant";

  const result = await generateToken({
    participantId: authenticatedUserId,
    participantName: req.user!.name,
    roomName: room._id.toString(),
    role,
  });

  res.status(200).json(ok(result));
});

export const receiveWebhook = asyncHandler(async (req: Request, res: Response) => {
  const rawBody = req.body as string; // express.text() on this route, not express.json()

  let event: WebhookEvent;
  try {
    event = await verifyWebhookEvent(rawBody, req.header("authorization"));
  } catch {
    throw new AppError("INVALID_SIGNATURE", "Webhook signature verification failed", 401);
  }

  const eventId =
    event.id ??
    `${event.event}:${event.room?.name ?? ""}:${event.participant?.identity ?? ""}:${String(event.createdAt ?? "")}`;

  // Claim the event id atomically. A failed claim means "already processed" --
  // acknowledge with 200 and do nothing further. This is the idempotency
  // guard: reconciliation logic below runs at most once per event id, no
  // matter how many times LiveKit retries delivery.
  const claimed = await redis.set(redisKeys.webhookEvent(eventId), "1", "EX", WEBHOOK_DEDUPE_TTL_SECONDS, "NX");
  if (claimed !== "OK") {
    res.status(200).json(ok(null, "Already processed"));
    return;
  }

  // Reconcile, never mutate: compute desired state from the event and
  // converge, rather than incrementing/decrementing a counter. A triple
  // delivered participant_left must not drive anything negative -- leave()
  // is already idempotent for exactly this reason.
  try {
    if (event.event === "participant_left" && event.room?.name && event.participant?.identity) {
      const room = await findRoomByIdOrName(event.room.name);
      if (room) {
        const userId = event.participant.identity;

        // Delivery is at-least-once AND unordered: a genuinely different,
        // late-arriving participant_left can describe a session the user has
        // already left and rejoined since. Discard anything that predates
        // the session currently open for this user in this room, rather than
        // reconciling it and evicting a member who legitimately rejoined.
        const currentSession = await ParticipantSessionModel.findOne({
          roomId: room._id,
          userId,
          active: true,
        });

        // `createdAt` is a protobuf int64 (bigint) count of seconds, not a
        // JS number -- verified against @livekit/protocol's WebhookEvent type.
        const eventTimestampMs =
          typeof event.createdAt === "bigint" ? Number(event.createdAt) * 1000 : Date.now();

        // The webhook timestamp only has whole-second resolution while
        // joinedAt has millisecond resolution, so joinedAt is floored to the
        // second before comparing -- otherwise a join and its own leave
        // webhook landing in the same wall-clock second would be misread as
        // "predates the session" purely from truncation, discarding a
        // legitimate, current event.
        const joinedAtFlooredMs = currentSession
          ? Math.floor(currentSession.joinedAt.getTime() / 1000) * 1000
          : 0;

        if (currentSession && joinedAtFlooredMs > eventTimestampMs) {
          logger.warn(
            { eventId, roomId: room._id.toString(), userId },
            "discarding out-of-order webhook event",
          );
        } else {
          await leave({ roomId: room._id.toString(), userId, reason: "livekit" });
        }
      }
    }
  } catch (error: unknown) {
    // A reconciliation failure must not fail the webhook response -- LiveKit
    // would retry, and the event id is already claimed, so a retry would be
    // silently dropped by the dedupe guard above rather than fixing anything.
    logger.error({ err: error, eventId, event: event.event }, "webhook reconciliation failed");
  }

  res.status(200).json(ok(null, "Processed"));
});
