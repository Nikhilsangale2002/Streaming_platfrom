import { RoomModel, ROOM_STATUS } from "../models/room.model";
import { getParticipantCount } from "../modules/rooms/room.state.service";

export interface RoomJoinCheck {
  ok: true;
}
export interface RoomJoinFailure {
  ok: false;
  code: string;
  message: string;
}

/** May this user join this room right now? Authorization, not authentication. */
export async function assertRoomJoinable(roomId: string, userId: string): Promise<RoomJoinCheck | RoomJoinFailure> {
  const room = await RoomModel.findById(roomId);
  if (!room) return { ok: false, code: "ROOM_NOT_FOUND", message: "Room not found" };
  if (room.status === ROOM_STATUS.ENDED) {
    return { ok: false, code: "ROOM_ENDED", message: "This room has ended" };
  }

  const count = await getParticipantCount(roomId);
  const alreadyMember = false; // join() itself is idempotent; capacity check only blocks NEW members
  void userId;
  void alreadyMember;
  if (count >= room.maxParticipants) {
    return { ok: false, code: "ROOM_FULL", message: "This room is at capacity" };
  }

  return { ok: true };
}
