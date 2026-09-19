import os from "node:os";
import mongoose from "mongoose";
import { env } from "../config/env";
import { logger } from "../utils/logger";

// Reject writes to fields absent from the schema instead of silently storing them.
mongoose.set("strictQuery", true);

export async function connectMongo(): Promise<void> {
  if (mongoose.connection.readyState === mongoose.ConnectionStates.connected) return;

  mongoose.connection.on("error", (error) => {
    logger.error({ err: error }, "mongodb connection error");
  });
  mongoose.connection.on("disconnected", () => {
    logger.warn("mongodb disconnected");
  });

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
    runtimeAdapters: { os },
  });

  logger.info("mongodb connected");
}

export async function disconnectMongo(): Promise<void> {
  if (mongoose.connection.readyState === mongoose.ConnectionStates.disconnected) return;
  await mongoose.disconnect();
  logger.info("mongodb disconnected");
}
