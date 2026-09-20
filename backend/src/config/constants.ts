export const WEBHOOK_DEDUPE_TTL_SECONDS = 86_400;
export const DEFAULT_MAX_PARTICIPANTS = 50;

export const redisKeys = {
  onlineUsers: () => "presence:online",
  userPresence: (userId: string) => `presence:user:${userId}`,
  userSockets: (userId: string) => `presence:user:${userId}:sockets`,
  roomParticipants: (roomId: string) => `room:${roomId}:participants`,
  webhookEvent: (eventId: string) => `livekit:webhook:${eventId}`,
  rateLimit: (ip: string, route: string) => `rl:${ip}:${route}`,
} as const;

export const socketRooms = {
  room: (roomId: string) => `room:${roomId}`,
  user: (userId: string) => `user:${userId}`,
} as const;
