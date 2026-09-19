import type { Request, Response } from "express";
import { UserModel } from "../../models/user.model";
import { RoomModel, ROOM_STATUS } from "../../models/room.model";
import { AppError } from "../../utils/AppError";
import { ok } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { parsedBody, parsedParams, parsedQuery } from "../../middleware/validate.middleware";
import { join, leave, getParticipantIds, getParticipantCounts } from "./room.state.service";
import { toRoomSummaryDto, toRoomDetailDto } from "./room.dto";
import type { CreateRoomInput, RoomIdParam, ListRoomsQuery } from "./room.schema";

export const createRoom = asyncHandler(async (req: Request, res: Response) => {
  const input = parsedBody<CreateRoomInput>(req);
  const hostId = req.user!.id;

  const room = await RoomModel.create({ name: input.name, host: hostId });
  const { participantCount } = await join({ roomId: room._id.toString(), userId: hostId, role: "host" });

  res.status(201).json(ok(toRoomSummaryDto(room, participantCount), "Room created"));
});

export const listRooms = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = parsedQuery<ListRoomsQuery>(req);

  const [rooms, total] = await Promise.all([
    RoomModel.find({ status: ROOM_STATUS.LIVE })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    RoomModel.countDocuments({ status: ROOM_STATUS.LIVE }),
  ]);

  const counts = await getParticipantCounts(rooms.map((room) => room._id.toString()));
  const dtos = rooms.map((room) => toRoomSummaryDto(room, counts[room._id.toString()] ?? 0));

  res.status(200).json(ok({ rooms: dtos, page, limit, total }));
});

export const getRoom = asyncHandler(async (req: Request, res: Response) => {
  const { id } = parsedParams<RoomIdParam>(req);

  const room = await RoomModel.findById(id);
  if (!room) throw new AppError("ROOM_NOT_FOUND", "Room not found", 404);

  const participantIds = await getParticipantIds(id);
  const users = await UserModel.find({ _id: { $in: participantIds } }).select("name");

  res.status(200).json(ok(toRoomDetailDto(room, participantIds, users)));
});

export const joinRoom = asyncHandler(async (req: Request, res: Response) => {
  const { id } = parsedParams<RoomIdParam>(req);
  const userId = req.user!.id;

  const room = await RoomModel.findById(id);
  if (!room) throw new AppError("ROOM_NOT_FOUND", "Room not found", 404);

  const result = await join({ roomId: id, userId, role: "participant" });
  res.status(200).json(ok(result, result.joined ? "Joined room" : "Already a member"));
});

export const leaveRoom = asyncHandler(async (req: Request, res: Response) => {
  const { id } = parsedParams<RoomIdParam>(req);
  const userId = req.user!.id;

  const result = await leave({ roomId: id, userId, reason: "rest" });
  res.status(200).json(ok(result, result.left ? "Left room" : "Not a member"));
});
