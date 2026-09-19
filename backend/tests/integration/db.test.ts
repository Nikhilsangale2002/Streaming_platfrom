import mongoose from "mongoose";
import { connectMongo, disconnectMongo } from "../../src/db/mongoose";
import { redis, disconnectRedis } from "../../src/db/redis";

describe("database connections", () => {
  afterAll(async () => {
    await disconnectMongo();
    await disconnectRedis();
  });

  it("connects to MongoDB", async () => {
    await connectMongo();

    expect(mongoose.connection.readyState).toBe(1);
  });

  it("round-trips a value through Redis", async () => {
    await redis.set("test:db:probe", "pong", "EX", 10);

    expect(await redis.get("test:db:probe")).toBe("pong");

    await redis.del("test:db:probe");
  });
});
