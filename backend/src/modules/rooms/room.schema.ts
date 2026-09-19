import { z } from "zod";
import { Types } from "mongoose";

export const createRoomSchema = z.object({
  name: z.string().trim().min(3).max(80),
});
export type CreateRoomInput = z.infer<typeof createRoomSchema>;

export const roomIdParamSchema = z.object({
  id: z.string().refine((value) => Types.ObjectId.isValid(value), "Invalid room id"),
});
export type RoomIdParam = z.infer<typeof roomIdParamSchema>;

export const listRoomsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListRoomsQuery = z.infer<typeof listRoomsQuerySchema>;
