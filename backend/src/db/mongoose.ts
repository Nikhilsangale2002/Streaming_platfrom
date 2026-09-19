import os from "node:os";
import mongoose from "mongoose";
import { env } from "../config/env";
import { logger } from "../utils/logger";

// Strip filter fields absent from the schema out of queries, so a typo'd
// filter key cannot silently widen a query.
mongoose.set("strictQuery", true);

// Registered once at module scope, not inside connectMongo(), which
// early-returns on the happy path but not across a genuine
// disconnect-then-reconnect cycle -- registering inside the function would
// accumulate listeners toward MaxListenersExceededWarning and duplicate logs.
mongoose.connection.on("error", (error) => {
  logger.error({ err: error }, "mongodb connection error");
});
mongoose.connection.on("disconnected", () => {
  logger.warn("mongodb disconnected");
});

export async function connectMongo(): Promise<void> {
  if (mongoose.connection.readyState === mongoose.ConnectionStates.connected) return;

  await mongoose.connect(env.MONGO_URI, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
    minPoolSize: 2,
    // The driver otherwise loads its OS metadata adapter via a dynamic
    // `import("os")`, which silently rejects under Jest's CJS sandbox
    // (ts-jest + jest-environment-node). The rejection is swallowed
    // internally and the handshake is sent with an empty client document,
    // which every MongoDB server rejects with "Missing required
    // sub-document 'driver'". Supplying the adapter directly is the
    // driver's own documented escape hatch for this class of runtime.
    // tests/integration/db.test.ts is the canary -- if a future driver
    // upgrade removes this field, that test's connection will fail loudly
    // instead of silently reverting to the original bug.
    runtimeAdapters: { os },
  });

  logger.info("mongodb connected");
}

export async function disconnectMongo(): Promise<void> {
  if (mongoose.connection.readyState === mongoose.ConnectionStates.disconnected) return;
  await mongoose.disconnect();
  logger.info("mongodb disconnected");
}
