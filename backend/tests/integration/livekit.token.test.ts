import jwt from "jsonwebtoken";
import request from "supertest";
import { createApp } from "../../src/app";
import { withTestDatabases } from "../helpers/db";

const app = createApp();

async function registerAndLogin(email: string) {
  const response = await request(app)
    .post("/api/auth/register")
    .send({ name: "LK User", email, password: "correct-horse" });
  return { token: response.body.data.token as string, userId: response.body.data.user.id as string };
}

describe("POST /api/livekit/token", () => {
  withTestDatabases();

  it("requires auth", async () => {
    const response = await request(app)
      .post("/api/livekit/token")
      .send({ userId: "x", roomName: "y", role: "participant" });
    expect(response.status).toBe(401);
  });

  it("issues a host token to the room's own host", async () => {
    const host = await registerAndLogin("lk-host@example.com");
    const createResponse = await request(app)
      .post("/api/rooms")
      .set("Authorization", `Bearer ${host.token}`)
      .send({ name: "LK Room" });
    const roomId = createResponse.body.data.id as string;

    const response = await request(app)
      .post("/api/livekit/token")
      .set("Authorization", `Bearer ${host.token}`)
      .send({ userId: host.userId, roomName: roomId, role: "host" });

    expect(response.status).toBe(200);
    expect(response.body.data.roomName).toBe(roomId);
    expect(typeof response.body.data.token).toBe("string");
  });

  it("issues a participant token to a non-host member", async () => {
    const host = await registerAndLogin("lk-host2@example.com");
    const guest = await registerAndLogin("lk-guest@example.com");
    const createResponse = await request(app)
      .post("/api/rooms")
      .set("Authorization", `Bearer ${host.token}`)
      .send({ name: "LK Room 2" });
    const roomId = createResponse.body.data.id as string;

    const response = await request(app)
      .post("/api/livekit/token")
      .set("Authorization", `Bearer ${guest.token}`)
      .send({ userId: guest.userId, roomName: roomId });

    expect(response.status).toBe(200);
  });

  it("returns 403 IDENTITY_MISMATCH when the body userId disagrees with the JWT", async () => {
    const caller = await registerAndLogin("lk-caller@example.com");
    const victim = await registerAndLogin("lk-victim@example.com");
    const createResponse = await request(app)
      .post("/api/rooms")
      .set("Authorization", `Bearer ${caller.token}`)
      .send({ name: "LK Room 3" });
    const roomId = createResponse.body.data.id as string;

    const response = await request(app)
      .post("/api/livekit/token")
      .set("Authorization", `Bearer ${caller.token}`)
      .send({ userId: victim.userId, roomName: roomId });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("IDENTITY_MISMATCH");
  });

  it("ignores a spoofed role: 'host' in the body for a non-host caller", async () => {
    const host = await registerAndLogin("lk-host3@example.com");
    const guest = await registerAndLogin("lk-guest2@example.com");
    const createResponse = await request(app)
      .post("/api/rooms")
      .set("Authorization", `Bearer ${host.token}`)
      .send({ name: "LK Room 4" });
    const roomId = createResponse.body.data.id as string;

    const response = await request(app)
      .post("/api/livekit/token")
      .set("Authorization", `Bearer ${guest.token}`)
      .send({ userId: guest.userId, roomName: roomId, role: "host" });

    expect(response.status).toBe(200);

    const decoded = jwt.decode(response.body.data.token as string) as {
      video?: { roomAdmin?: boolean };
    };
    expect(decoded.video?.roomAdmin).not.toBe(true);
  });

  it("returns 404 for a room that does not exist", async () => {
    const user = await registerAndLogin("lk-404@example.com");

    const response = await request(app)
      .post("/api/livekit/token")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ userId: user.userId, roomName: "507f1f77bcf86cd799439011" });

    expect(response.status).toBe(404);
  });
});
