export interface RoomParticipantSummary {
  id: string;
  name: string;
}

export interface ClientToServerEvents {
  "room:join": (
    payload: { roomId: string },
    ack: (result: { ok: true } | { ok: false; code: string; message: string }) => void,
  ) => void;
  "room:leave": (payload: { roomId: string }) => void;
  "room:message": (payload: { roomId: string; text: string }) => void;
}

export interface ServerToClientEvents {
  "user:online": (payload: { userId: string }) => void;
  "user:offline": (payload: { userId: string }) => void;
  "room:participant_joined": (payload: { roomId: string; participant: RoomParticipantSummary }) => void;
  "room:participant_left": (payload: { roomId: string; userId: string }) => void;
  "room:participant_count": (payload: { roomId: string; count: number }) => void;
  "room:status": (payload: { roomId: string; status: "live" | "ended" }) => void;
  "room:message": (payload: { roomId: string; userId: string; text: string; sentAt: string }) => void;
  error: (payload: { code: string; message: string }) => void;
}

// No cross-instance server events are needed yet; the Redis adapter alone
// handles cross-instance broadcast. Declared for symmetry with the
// Server<> generic signature.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface InterServerEvents {}

export interface SocketData {
  userId: string;
  userName: string;
}
