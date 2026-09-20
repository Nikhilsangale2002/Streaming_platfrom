import http from "node:http";
import { createApp } from "./app";
import { env } from "./config/env";
import { connectMongo, disconnectMongo } from "./db/mongoose";
import { disconnectRedis } from "./db/redis";
import { attachSocketServer } from "./realtime/io";
import { logger } from "./utils/logger";

const server = http.createServer(createApp());
const io = attachSocketServer(server);

async function start(): Promise<void> {
  await connectMongo();

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "api listening");
  });
}

let shuttingDown = false;

async function shutdown(signal: string, code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");

  // If a stuck connection or a hung disconnect prevents clean shutdown,
  // force exit rather than rely on Docker's SIGKILL at the 10s mark -- this
  // way the failure is logged before the process dies.
  const watchdog = setTimeout(() => {
    logger.error("graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, 10_000).unref();

  try {
    // A live WebSocket connection keeps the underlying http.Server "open"
    // from server.close()'s perspective indefinitely, so server.close()
    // alone would never resolve while a client is connected -- the 10s
    // watchdog above would then force-exit on every deploy, and no `disconnect`
    // handler would run to clear this instance's Redis room/presence state.
    //
    // io.close() tears down every Socket.IO connection first (each fires its
    // `disconnect` handler) and, per socket.io v4's Server.close(), also
    // closes the http.Server it was attached to -- so a separate
    // server.close() call is unnecessary and would just be a no-op against
    // an already-closed server. closeIdleConnections() runs first so idle
    // keep-alive REST connections don't independently block that same close.
    server.closeIdleConnections();
    await new Promise<void>((resolve) => {
      void io.close(() => resolve());
    });
    await disconnectMongo();
    await disconnectRedis();
    logger.info("shutdown complete");
  } catch (error: unknown) {
    logger.error({ err: error }, "error during shutdown");
    code = 1;
  } finally {
    clearTimeout(watchdog);
    process.exit(code);
  }
}

// Docker sends SIGTERM; tini forwards it. Ctrl-C sends SIGINT.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "unhandled rejection");
  void shutdown("unhandledRejection", 1);
});

start().catch((error: unknown) => {
  logger.fatal({ err: error }, "failed to start");
  process.exit(1);
});
