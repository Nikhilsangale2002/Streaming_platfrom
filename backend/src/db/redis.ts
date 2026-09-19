import { Redis } from "ioredis";
import { env } from "../config/env";
import { logger } from "../utils/logger";

function createClient(role: string): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
    enableReadyCheck: true,
  });

  client.on("error", (error) => {
    logger.error({ err: error, role }, "redis error");
  });
  client.on("ready", () => {
    logger.info({ role }, "redis ready");
  });

  return client;
}

/** Command client: presence, room membership, rate limiting, webhook dedupe. */
export const redis = createClient("command");

let pubSubPair: { pub: Redis; sub: Redis } | undefined;

/** Lazily created pair for `@socket.io/redis-adapter`. */
export function createRedisPubSubPair(): { pub: Redis; sub: Redis } {
  pubSubPair ??= { pub: createClient("pub"), sub: createClient("sub") };
  return pubSubPair;
}

export async function disconnectRedis(): Promise<void> {
  const clients = [redis, pubSubPair?.pub, pubSubPair?.sub].filter(
    (client): client is Redis => client !== undefined,
  );

  await Promise.all(clients.map((client) => client.quit()));
  pubSubPair = undefined;
  logger.info("redis disconnected");
}
