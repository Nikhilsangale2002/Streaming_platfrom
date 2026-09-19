import type { IRoom } from "../../models/room.model";
import type { IUser } from "../../models/user.model";

export interface RoomSummaryDto {
  id: string;
  name: string;
  host: string;
  status: IRoom["status"];
  participantCount: number;
  maxParticipants: number;
  createdAt: Date;
}

export interface RoomParticipantDto {
  id: string;
  name: string;
}

export interface RoomDetailDto extends RoomSummaryDto {
  participants: RoomParticipantDto[];
}

type RoomWithId = IRoom & { _id: unknown };

export function toRoomSummaryDto(room: RoomWithId, participantCount: number): RoomSummaryDto {
  return {
    id: String(room._id),
    name: room.name,
    host: String(room.host),
    status: room.status,
    participantCount,
    maxParticipants: room.maxParticipants,
    createdAt: room.createdAt,
  };
}

export function toRoomDetailDto(
  room: RoomWithId,
  participantIds: string[],
  users: (Pick<IUser, "name"> & { _id: unknown })[],
): RoomDetailDto {
  const userById = new Map(users.map((user) => [String(user._id), user.name]));

  return {
    ...toRoomSummaryDto(room, participantIds.length),
    participants: participantIds.map((id) => ({ id, name: userById.get(id) ?? "Unknown" })),
  };
}
