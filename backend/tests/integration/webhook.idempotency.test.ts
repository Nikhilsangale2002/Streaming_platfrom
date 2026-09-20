import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { createApp } from "../../src/app";
import { withTestDatabases } from "../helpers/db";
import { env } from "../../src/config/env";
import { redis } from "../../src/db/redis";
import { UserModel } from "../../src/models/user.model";
import { RoomModel } from "../../src/models/room.model";
import { ParticipantSessionModel } from "../../src/models/participantSession.model";
import { join, getParticipantIds, getParticipantCount } from "../../src/modules/rooms/room.state.service";
import * as roomStateService from "../../src/modules/rooms/room.state.service";

function signWebhook(bodyString: string): string {
  const sha256 = crypto.createHash("sha256").update(bodyString).digest("base64");
  return jwt.sign({ sha256 }, env.LIVEKIT_API_SECRET, {
    issuer: env.LIVEKIT_API_KEY,
    expiresIn: "5m",
  });
}

function buildEvent(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    event: "participant_left",
    id: "evt-1",
    createdAt: Math.floor(Date.now() / 1000),
    room: { name: "placeholder" },
    participant: { identity: "placeholder" },
    ...overrides,
  });
}

const app = createApp();

describe("POST /api/livekit/webhook", () => {
  withTestDatabases();

  it("rejects a request with a bad signature", async () => {
    const body = buildEvent({});

    const response = await request(app)
      .post("/api/livekit/webhook")
      .set("Content-Type", "application/json")
      .set("Authorization", "not-a-valid-signature")
      .send(body);

    expect(response.status).toBe(401);
  });

  it("accepts a validly signed event and returns 200", async () => {
    const host = await UserModel.create({ name: "WH Host", email: "wh1@e.com", passwordHash: "h" });
    const room = await RoomModel.create({ name: "WH Room", host: host._id });
    await join({ roomId: room._id.toString(), userId: host._id.toString(), role: "host" });

    const body = buildEvent({
      id: "evt-accept",
      room: { name: room._id.toString() },
      participant: { identity: host._id.toString() },
    });
    const signature = signWebhook(body);

    const response = await request(app)
      .post("/api/livekit/webhook")
      .set("Content-Type", "application/json")
      .set("Authorization", signature)
      .send(body);

    expect(response.status).toBe(200);
  });

  it("a duplicate delivery of the same event id is dropped, not double-processed", async () => {
    const host = await UserModel.create({ name: "WH Host2", email: "wh2@e.com", passwordHash: "h" });
    const room = await RoomModel.create({ name: "WH Room2", host: host._id });
    await join({ roomId: room._id.toString(), userId: host._id.toString(), role: "host" });

    const leaveSpy = jest.spyOn(roomStateService, "leave");

    const body = buildEvent({
      id: "evt-dup",
      room: { name: room._id.toString() },
      participant: { identity: host._id.toString() },
    });
    const signature = signWebhook(body);

    const first = await request(app)
      .post("/api/livekit/webhook")
      .set("Content-Type", "application/json")
      .set("Authorization", signature)
      .send(body);
    const second = await request(app)
      .post("/api/livekit/webhook")
      .set("Content-Type", "application/json")
      .set("Authorization", signature)
      .send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    // The dedupe guard must drop the second delivery BEFORE reconciliation
    // runs at all -- not merely tolerate leave() running twice because it
    // happens to be idempotent. This is what actually proves the second
    // delivery was dropped, rather than just re-converging to the same state.
    expect(leaveSpy).toHaveBeenCalledTimes(1);

    const updated = await RoomModel.findById(room._id);
    expect(updated?.status).toBe("ended"); // host left exactly once, not toggled

    const dedupeKey = await redis.get(`livekit:webhook:evt-dup`);
    expect(dedupeKey).not.toBeNull();

    leaveSpy.mockRestore();
  });

  it("an out-of-order participant_left webhook (predating the current session) is discarded, not reconciled", async () => {
    const host = await UserModel.create({ name: "WH Host4", email: "wh4@e.com", passwordHash: "h" });
    const room = await RoomModel.create({ name: "WH Room4", host: host._id });
    const guest = await UserModel.create({ name: "WH Guest", email: "wh4g@e.com", passwordHash: "h" });
    await join({ roomId: room._id.toString(), userId: host._id.toString(), role: "host" });

    // Guest joins, leaves, then rejoins -- opening a second, later session.
    await join({ roomId: room._id.toString(), userId: guest._id.toString(), role: "participant" });
    await roomStateService.leave({ roomId: room._id.toString(), userId: guest._id.toString(), reason: "rest" });
    await join({ roomId: room._id.toString(), userId: guest._id.toString(), role: "participant" });

    const leaveSpy = jest.spyOn(roomStateService, "leave");

    // A stale participant_left describing the FIRST (already-closed) session,
    // timestamped well before the rejoin above.
    const staleTimestampSec = Math.floor((Date.now() - 60_000) / 1000);
    const body = buildEvent({
      id: "evt-out-of-order",
      createdAt: staleTimestampSec,
      room: { name: room._id.toString() },
      participant: { identity: guest._id.toString() },
    });
    const signature = signWebhook(body);

    const response = await request(app)
      .post("/api/livekit/webhook")
      .set("Content-Type", "application/json")
      .set("Authorization", signature)
      .send(body);

    expect(response.status).toBe(200);
    expect(leaveSpy).not.toHaveBeenCalled();

    // The guest's CURRENT (post-rejoin) session must be untouched.
    const currentSession = await ParticipantSessionModel.findOne({
      roomId: room._id,
      userId: guest._id,
      active: true,
    });
    expect(currentSession).not.toBeNull();

    await expect(getParticipantIds(room._id.toString())).resolves.toContain(guest._id.toString());
    await expect(getParticipantCount(room._id.toString())).resolves.toBe(2);

    leaveSpy.mockRestore();
  });

  it("a reconciliation failure is caught and still returns 200 (LiveKit must not retry a claimed event)", async () => {
    const host = await UserModel.create({ name: "WH Host3", email: "wh3@e.com", passwordHash: "h" });
    const room = await RoomModel.create({ name: "WH Room3", host: host._id });
    await join({ roomId: room._id.toString(), userId: host._id.toString(), role: "host" });

    const leaveSpy = jest.spyOn(roomStateService, "leave").mockRejectedValueOnce(new Error("boom"));

    const body = buildEvent({
      id: "evt-reconcile-fail",
      room: { name: room._id.toString() },
      participant: { identity: host._id.toString() },
    });
    const signature = signWebhook(body);

    const response = await request(app)
      .post("/api/livekit/webhook")
      .set("Content-Type", "application/json")
      .set("Authorization", signature)
      .send(body);

    expect(response.status).toBe(200);
    expect(leaveSpy).toHaveBeenCalledTimes(1);

    leaveSpy.mockRestore();
  });

  it("an unknown room in the event is tolerated, not a 500", async () => {
    const body = buildEvent({
      id: "evt-unknown-room",
      room: { name: "000000000000000000000000" },
      participant: { identity: "000000000000000000000001" },
    });
    const signature = signWebhook(body);

    const response = await request(app)
      .post("/api/livekit/webhook")
      .set("Content-Type", "application/json")
      .set("Authorization", signature)
      .send(body);

    expect(response.status).toBe(200);
  });
});
