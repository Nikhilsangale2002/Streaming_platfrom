export const PRESENCE_TTL_SECONDS = 60;
export const PRESENCE_HEARTBEAT_SECONDS = 30;
export const WEBHOOK_DEDUPE_TTL_SECONDS = 86_400;
export const DEFAULT_MAX_PARTICIPANTS = 50;

export const redisKeys = {
  onlineUsers: () => "presence:online",
  userPresence: (userId: string) => `presence:user:${userId}`,
  userSockets: (userId: string) => `presence:user:${userId}:sockets`,
  roomParticipants: (roomId: string) => `room:${roomId}:participants`,
  webhookEvent: (eventId: string) => `livekit:webhook:${eventId}`,
} as const;

export const socketRooms = {
  room: (roomId: string) => `room:${roomId}`,
  user: (userId: string) => `user:${userId}`,
} as const;
