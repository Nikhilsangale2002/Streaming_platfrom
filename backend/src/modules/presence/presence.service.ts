import { redis } from "../../db/redis";
import { redisKeys } from "../../config/constants";

export async function markSocketConnected(
  userId: string,
  socketId: string,
): Promise<{ wentOnline: boolean }> {
  const socketsKey = redisKeys.userSockets(userId);

  // No TTL on these keys: correctness relies solely on the explicit SADD/SREM
  // transitions below, not on a redundant expiry racing a live socket. A
  // socket that outlives a TTL would silently vanish from presence while
  // still connected -- Socket.IO's own ping/pong keepalive is what detects a
  // truly dead connection and fires `disconnect`.
  const pipeline = redis.pipeline();
  pipeline.sadd(socketsKey, socketId);
  pipeline.scard(socketsKey);
  pipeline.set(redisKeys.userPresence(userId), "1");
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

export async function isOnline(userId: string): Promise<boolean> {
  const exists = await redis.exists(redisKeys.userPresence(userId));
  return exists === 1;
}

export async function getOnlineUserIds(): Promise<string[]> {
  return redis.smembers(redisKeys.onlineUsers());
}
