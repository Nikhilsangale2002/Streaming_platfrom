import type { Socket } from "socket.io";
import { UserModel } from "../models/user.model";
import { verifyAccessToken } from "../modules/auth/auth.service";
import type { ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData } from "./events";

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export async function socketAuthMiddleware(
  socket: AppSocket,
  next: (err?: Error) => void,
): Promise<void> {
  const token = socket.handshake.auth["token"] as unknown;

  if (typeof token !== "string" || token.length === 0) {
    next(new Error("UNAUTHORIZED"));
    return;
  }

  try {
    const { sub } = verifyAccessToken(token);
    const user = await UserModel.findById(sub);
    if (!user) {
      next(new Error("UNAUTHORIZED"));
      return;
    }
    socket.data.userId = user._id.toString();
    socket.data.userName = user.name;
    next();
  } catch {
    next(new Error("UNAUTHORIZED"));
  }
}
