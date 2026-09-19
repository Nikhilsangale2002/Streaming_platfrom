import type { Server, Socket } from "socket.io";
import { z } from "zod";
import { UserModel } from "../../models/user.model";
import { join, leave } from "../../modules/rooms/room.state.service";
import { assertRoomJoinable } from "../socket.guards";
import { socketRooms } from "../../config/constants";
import { logger } from "../../utils/logger";
import type { ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData } from "../events";

type AppServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const roomJoinPayloadSchema = z.object({ roomId: z.string().min(1) });
const roomLeavePayloadSchema = z.object({ roomId: z.string().min(1) });
const roomMessagePayloadSchema = z.object({ roomId: z.string().min(1), text: z.string().min(1).max(2000) });

/** Tracks which rooms this socket has joined, so disconnect can clean all of them up. */
function joinedRooms(socket: AppSocket): Set<string> {
  const existing = (socket.data as unknown as { _joinedRooms?: Set<string> })._joinedRooms;
  if (existing) return existing;
  const created = new Set<string>();
  (socket.data as unknown as { _joinedRooms: Set<string> })._joinedRooms = created;
  return created;
}

function broadcastLeaveOutcome(
  io: AppServer,
  roomId: string,
  userId: string,
  outcome: { left: boolean; participantCount: number; roomEnded: boolean },
): void {
  if (!outcome.left) return;

  io.to(socketRooms.room(roomId)).emit("room:participant_left", { roomId, userId });
  io.to(socketRooms.room(roomId)).emit("room:participant_count", { roomId, count: outcome.participantCount });
  if (outcome.roomEnded) {
    io.to(socketRooms.room(roomId)).emit("room:status", { roomId, status: "ended" });
  }
}

export function registerRoomHandlers(io: AppServer, socket: AppSocket): void {
  socket.on("room:join", (payload, ack) => {
    void (async () => {
      try {
        const parsed = roomJoinPayloadSchema.safeParse(payload);
        if (!parsed.success) {
          ack({ ok: false, code: "VALIDATION_ERROR", message: "Invalid payload" });
          return;
        }
        const { roomId } = parsed.data;
        const userId = socket.data.userId;

        const check = await assertRoomJoinable(roomId, userId);
        if (!check.ok) {
          ack({ ok: false, code: check.code, message: check.message });
          return;
        }

        const result = await join({ roomId, userId, role: "participant" });
        await socket.join(socketRooms.room(roomId));
        joinedRooms(socket).add(roomId);

        if (result.joined) {
          const user = await UserModel.findById(userId).select("name");
          io.to(socketRooms.room(roomId)).emit("room:participant_joined", {
            roomId,
            participant: { id: userId, name: user?.name ?? "Unknown" },
          });
          io.to(socketRooms.room(roomId)).emit("room:participant_count", {
            roomId,
            count: result.participantCount,
          });
        }

        ack({ ok: true });
      } catch (error: unknown) {
        logger.error({ err: error, userId: socket.data.userId }, "room:join failed");
        ack({ ok: false, code: "INTERNAL_ERROR", message: "Something went wrong" });
      }
    })();
  });

  socket.on("room:leave", (payload) => {
    void (async () => {
      try {
        const parsed = roomLeavePayloadSchema.safeParse(payload);
        if (!parsed.success) return;
        const { roomId } = parsed.data;

        const outcome = await leave({ roomId, userId: socket.data.userId, reason: "socket" });
        await socket.leave(socketRooms.room(roomId));
        joinedRooms(socket).delete(roomId);
        broadcastLeaveOutcome(io, roomId, socket.data.userId, outcome);
      } catch (error: unknown) {
        logger.error({ err: error, userId: socket.data.userId }, "room:leave failed");
      }
    })();
  });

  socket.on("room:message", (payload) => {
    try {
      const parsed = roomMessagePayloadSchema.safeParse(payload);
      if (!parsed.success) return;
      const { roomId, text } = parsed.data;

      // Scoped to the room only -- proves events reach relevant sockets and
      // no others (see tests/integration/socket.isolation.test.ts).
      io.to(socketRooms.room(roomId)).emit("room:message", {
        roomId,
        userId: socket.data.userId,
        text,
        sentAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      logger.error({ err: error, userId: socket.data.userId }, "room:message failed");
    }
  });

  socket.on("disconnect", () => {
    void (async () => {
      // Every room this socket had joined must be cleaned up, not just the
      // last one -- and one room's failure must not skip the rest, so each
      // iteration gets its own try/catch rather than wrapping the whole loop.
      for (const roomId of joinedRooms(socket)) {
        try {
          const outcome = await leave({ roomId, userId: socket.data.userId, reason: "disconnect" });
          broadcastLeaveOutcome(io, roomId, socket.data.userId, outcome);
        } catch (error: unknown) {
          logger.error(
            { err: error, userId: socket.data.userId, socketId: socket.id, roomId },
            "disconnect cleanup failed for room",
          );
        }
      }
    })();
  });
}
