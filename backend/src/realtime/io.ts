import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createRedisPubSubPair } from "../db/redis";
import { logger } from "../utils/logger";
import { socketAuthMiddleware } from "./socket.auth";
import { registerRoomHandlers } from "./handlers/room.handlers";
import { registerPresenceHandlers } from "./handlers/presence.handlers";
import type { ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData } from "./events";

export function attachSocketServer(
  httpServer: HttpServer,
): Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData> {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
    cors: { origin: true, credentials: true },
  });

  const { pub, sub } = createRedisPubSubPair();
  io.adapter(createAdapter(pub, sub));

  io.use((socket, next) => {
    void socketAuthMiddleware(socket, next);
  });

  io.on("connection", (socket) => {
    logger.info({ socketId: socket.id, userId: socket.data.userId }, "socket connected");
    registerPresenceHandlers(io, socket);
    registerRoomHandlers(io, socket);
  });

  return io;
}
