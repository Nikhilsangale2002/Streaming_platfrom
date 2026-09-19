import http from "node:http";
import { createApp } from "./app";
import { env } from "./config/env";
import { connectMongo, disconnectMongo } from "./db/mongoose";
import { disconnectRedis } from "./db/redis";
import { logger } from "./utils/logger";

const server = http.createServer(createApp());

async function start(): Promise<void> {
  await connectMongo();

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "api listening");
  });
}

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");

  // Stop accepting new connections, then release the stores.
  await new Promise<void>((resolve) => server.close(() => { resolve(); }));
  await disconnectMongo();
  await disconnectRedis();

  logger.info("shutdown complete");
  process.exit(0);
}

// Docker sends SIGTERM; tini forwards it. Ctrl-C sends SIGINT.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "unhandled rejection");
  void shutdown("unhandledRejection");
});

start().catch((error: unknown) => {
  logger.fatal({ err: error }, "failed to start");
  process.exit(1);
});
