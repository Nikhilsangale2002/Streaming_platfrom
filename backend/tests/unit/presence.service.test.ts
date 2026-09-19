import { withTestDatabases } from "../helpers/db";
import { redis } from "../../src/db/redis";
import {
  markSocketConnected,
  markSocketDisconnected,
  isOnline,
  getOnlineUserIds,
} from "../../src/modules/presence/presence.service";

describe("presence.service", () => {
  withTestDatabases();

  it("marks a user online on the first socket and reports it via isOnline", async () => {
    const result = await markSocketConnected("user-1", "socket-a");

    expect(result.wentOnline).toBe(true);
    await expect(isOnline("user-1")).resolves.toBe(true);
    await expect(getOnlineUserIds()).resolves.toContain("user-1");
  });

  it("a second socket for the same user does not re-fire wentOnline", async () => {
    await markSocketConnected("user-1", "socket-a");
    const second = await markSocketConnected("user-1", "socket-b");

    expect(second.wentOnline).toBe(false);
  });

  it("multi-tab: disconnecting one of two sockets keeps the user online", async () => {
    await markSocketConnected("user-1", "socket-a");
    await markSocketConnected("user-1", "socket-b");

    const result = await markSocketDisconnected("user-1", "socket-a");

    expect(result.wentOffline).toBe(false);
    await expect(isOnline("user-1")).resolves.toBe(true);
  });

  it("disconnecting the last socket marks the user offline", async () => {
    await markSocketConnected("user-1", "socket-a");

    const result = await markSocketDisconnected("user-1", "socket-a");

    expect(result.wentOffline).toBe(true);
    await expect(isOnline("user-1")).resolves.toBe(false);
    await expect(getOnlineUserIds()).resolves.not.toContain("user-1");
  });

  it("disconnecting a socket that was never connected is a safe no-op", async () => {
    const result = await markSocketDisconnected("user-1", "never-connected");

    expect(result.wentOffline).toBe(false);
  });

  it("heartbeat refreshes the presence TTL without changing socket membership", async () => {
    await markSocketConnected("user-1", "socket-a");
    const key = "presence:user:user-1";

    await redis.expire(key, 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await import("../../src/modules/presence/presence.service").then((m) => m.heartbeat("user-1"));
    const ttl = await redis.ttl(key);

    expect(ttl).toBeGreaterThan(1);
  });
});
