import { redis } from "../../db/redis";
import { redisKeys, PRESENCE_TTL_SECONDS } from "../../config/constants";

export async function markSocketConnected(
  userId: string,
  socketId: string,
): Promise<{ wentOnline: boolean }> {
  const socketsKey = redisKeys.userSockets(userId);

  const pipeline = redis.pipeline();
  pipeline.sadd(socketsKey, socketId);
  pipeline.scard(socketsKey);
  pipeline.expire(socketsKey, PRESENCE_TTL_SECONDS);
  pipeline.set(redisKeys.userPresence(userId), "1", "EX", PRESENCE_TTL_SECONDS);
  pipeline.sadd(redisKeys.onlineUsers(), userId);
  const results = await pipeline.exec();

  const socketCountAfter = Number(results?.[1]?.[1] ?? 0);
  const wasFirstSocket = socketCountAfter === 1;

  return { wentOnline: wasFirstSocket };
}

export async function markSocketDisconnected(
  userId: string,
  socketId: string,
): Promise<{ wentOffline: boolean }> {
  const socketsKey = redisKeys.userSockets(userId);

  const removed = await redis.srem(socketsKey, socketId);
  if (removed === 0) return { wentOffline: false };

  const remaining = await redis.scard(socketsKey);
  if (remaining > 0) return { wentOffline: false };

  await redis.del(redisKeys.userPresence(userId));
  await redis.srem(redisKeys.onlineUsers(), userId);
  return { wentOffline: true };
}

export async function heartbeat(userId: string): Promise<void> {
  await redis.expire(redisKeys.userPresence(userId), PRESENCE_TTL_SECONDS);
  await redis.expire(redisKeys.userSockets(userId), PRESENCE_TTL_SECONDS);
}

export async function isOnline(userId: string): Promise<boolean> {
  const exists = await redis.exists(redisKeys.userPresence(userId));
  return exists === 1;
}

export async function getOnlineUserIds(): Promise<string[]> {
  return redis.smembers(redisKeys.onlineUsers());
}
