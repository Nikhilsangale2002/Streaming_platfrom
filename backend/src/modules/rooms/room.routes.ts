import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validate.middleware";
import { createRoomSchema, roomIdParamSchema, listRoomsQuerySchema } from "./room.schema";
import { createRoom, listRooms, getRoom, joinRoom, leaveRoom } from "./room.controller";

export const roomRouter = Router();
roomRouter.use(requireAuth);

roomRouter.post("/", validate({ body: createRoomSchema }), createRoom);
roomRouter.get("/", validate({ query: listRoomsQuerySchema }), listRooms);
roomRouter.get("/:id", validate({ params: roomIdParamSchema }), getRoom);
roomRouter.post("/:id/join", validate({ params: roomIdParamSchema }), joinRoom);
roomRouter.post("/:id/leave", validate({ params: roomIdParamSchema }), leaveRoom);
