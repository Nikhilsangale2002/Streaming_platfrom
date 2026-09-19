import mongoose from "mongoose";
import { connectMongo, disconnectMongo } from "../../src/db/mongoose";
import { redis, disconnectRedis } from "../../src/db/redis";

/**
 * Connects both stores for a suite, clears them between tests, and tears
 * everything down afterwards. Call inside `describe`, not inside a test.
 */
export function withTestDatabases(): void {
  beforeAll(async () => {
    await connectMongo();
  });

  beforeEach(async () => {
    const collections = await mongoose.connection.db?.collections();
    await Promise.all((collections ?? []).map((collection) => collection.deleteMany({})));
    await redis.flushdb();
  });

  afterAll(async () => {
    await disconnectMongo();
    await disconnectRedis();
  });
}
