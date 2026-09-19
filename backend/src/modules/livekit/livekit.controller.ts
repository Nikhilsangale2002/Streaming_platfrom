import type { Request, Response } from "express";
import { Types } from "mongoose";
import { RoomModel } from "../../models/room.model";
import { AppError } from "../../utils/AppError";
import { ok } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { parsedBody } from "../../middleware/validate.middleware";
import { generateToken } from "./livekit.service";
import type { TokenRequestInput } from "./livekit.schema";

export const issueToken = asyncHandler(async (req: Request, res: Response) => {
  const input = parsedBody<TokenRequestInput>(req);
  const authenticatedUserId = req.user!.id;

  // The identity-spoofing guard: a caller-supplied userId that disagrees
  // with the verified JWT is rejected outright, regardless of the brief's
  // example request shape carrying userId for compatibility.
  if (input.userId !== authenticatedUserId) {
    throw new AppError("IDENTITY_MISMATCH", "userId does not match the authenticated user", 403);
  }

  let room = null;
  if (Types.ObjectId.isValid(input.roomName)) {
    room = await RoomModel.findById(input.roomName);
  }
  room ??= await RoomModel.findOne({ name: input.roomName });
  if (!room) throw new AppError("ROOM_NOT_FOUND", "Room not found", 404);

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
