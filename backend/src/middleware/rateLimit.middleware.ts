import rateLimit from "express-rate-limit";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { redis } from "../db/redis";
import { redisKeys } from "../config/constants";
import { AppError } from "../utils/AppError";

/**
 * Shared across every backend instance via Redis, so the limit is real even
 * when horizontally scaled — an in-memory limiter would let a client reset
 * its budget just by hitting a different instance.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    // `redis.call`'s rest-parameter overload needs a tuple, not `string[]`;
    // the runtime shape is identical, so the cast is safe.
    sendCommand: (...args: string[]) =>
      redis.call(...(args as [string, ...string[]])) as Promise<RedisReply>,
    prefix: redisKeys.rateLimit("", "auth").replace(/:$/, ":"),
  }),
  handler: (_req, _res, next) => {
    next(new AppError("RATE_LIMITED", "Too many requests, try again later", 429));
  },
});
