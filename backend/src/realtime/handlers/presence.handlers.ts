import type { Server, Socket } from "socket.io";
import { markSocketConnected, markSocketDisconnected } from "../../modules/presence/presence.service";
import { socketRooms } from "../../config/constants";
import { logger } from "../../utils/logger";
import type { ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData } from "../events";

type AppServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export function registerPresenceHandlers(io: AppServer, socket: AppSocket): void {
  void (async () => {
    try {
      const { wentOnline } = await markSocketConnected(socket.data.userId, socket.id);
      if (wentOnline) {
        io.emit("user:online", { userId: socket.data.userId });
      }
    } catch (error: unknown) {
      logger.error({ err: error, userId: socket.data.userId, socketId: socket.id }, "failed to mark socket connected");
    }
  })();

  socket.on("disconnect", () => {
    void (async () => {
      try {
        const { wentOffline } = await markSocketDisconnected(socket.data.userId, socket.id);
        if (wentOffline) {
          io.emit("user:offline", { userId: socket.data.userId });
        }
      } catch (error: unknown) {
        logger.error({ err: error, userId: socket.data.userId, socketId: socket.id }, "failed to mark socket disconnected");
      }
    })();
  });

  // Kept for symmetry with room.handlers -- socketRooms.user() is the
  // targeted-broadcast primitive a later plan phase will use for DMs/notices.
  void socketRooms.user(socket.data.userId);
}
