import request from "supertest";
import { createApp } from "../../src/app";
import { withTestDatabases } from "../helpers/db";

const app = createApp();

async function registerAndLogin(email: string) {
  const response = await request(app)
    .post("/api/auth/register")
    .send({ name: "User", email, password: "correct-horse" });
  return response.body.data.token as string;
}

describe("room routes", () => {
  withTestDatabases();

  describe("POST /api/rooms", () => {
    it("requires auth", async () => {
      const response = await request(app).post("/api/rooms").send({ name: "My Room" });
      expect(response.status).toBe(401);
    });

    it("creates a room, makes the creator the host, and auto-joins them", async () => {
      const token = await registerAndLogin("host@example.com");

      const response = await request(app)
        .post("/api/rooms")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Morning Show" });

      expect(response.status).toBe(201);
      expect(response.body.data.name).toBe("Morning Show");
      expect(response.body.data.status).toBe("live");
      expect(response.body.data.participantCount).toBe(1);
    });

    it("rejects a room name shorter than 3 characters with 422", async () => {
      const token = await registerAndLogin("host2@example.com");

      const response = await request(app)
        .post("/api/rooms")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "ab" });

      expect(response.status).toBe(422);
    });
  });

  describe("GET /api/rooms", () => {
    it("lists only live rooms, newest first, with participantCount and no participants array", async () => {
      const token = await registerAndLogin("lister@example.com");
      await request(app).post("/api/rooms").set("Authorization", `Bearer ${token}`).send({ name: "Room A" });
      await request(app).post("/api/rooms").set("Authorization", `Bearer ${token}`).send({ name: "Room B" });

      const response = await request(app).get("/api/rooms").set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.rooms).toHaveLength(2);
      expect(response.body.data.rooms[0].name).toBe("Room B");
      expect(response.body.data.rooms[0]).not.toHaveProperty("participants");
    });
  });

  describe("GET /api/rooms/:id", () => {
    it("returns 404 for a non-existent room", async () => {
      const token = await registerAndLogin("getter@example.com");

      const response = await request(app)
        .get("/api/rooms/507f1f77bcf86cd799439011")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(404);
    });

    it("returns full participant details for an existing room", async () => {
      const token = await registerAndLogin("getter2@example.com");
      const createResponse = await request(app)
        .post("/api/rooms")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Detail Room" });
      const roomId = createResponse.body.data.id as string;

      const response = await request(app).get(`/api/rooms/${roomId}`).set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.participants).toHaveLength(1);
      expect(response.body.data.participants[0].name).toBe("User");
    });
  });

  describe("POST /api/rooms/:id/join and /leave", () => {
    it("lets a second user join and increments participantCount", async () => {
      const hostToken = await registerAndLogin("join-host@example.com");
      const guestToken = await registerAndLogin("join-guest@example.com");
      const createResponse = await request(app)
        .post("/api/rooms")
        .set("Authorization", `Bearer ${hostToken}`)
        .send({ name: "Join Room" });
      const roomId = createResponse.body.data.id as string;

      const response = await request(app)
        .post(`/api/rooms/${roomId}/join`)
        .set("Authorization", `Bearer ${guestToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.participantCount).toBe(2);
    });

    it("joining twice is idempotent, not an error", async () => {
      const token = await registerAndLogin("dup-join@example.com");
      const createResponse = await request(app)
        .post("/api/rooms")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Dup Join Room" });
      const roomId = createResponse.body.data.id as string;

      const response = await request(app)
        .post(`/api/rooms/${roomId}/join`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.participantCount).toBe(1);
    });

    it("returns 409 joining an ended room", async () => {
      const token = await registerAndLogin("ended-join@example.com");
      const createResponse = await request(app)
        .post("/api/rooms")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Ends Room" });
      const roomId = createResponse.body.data.id as string;
      await request(app).post(`/api/rooms/${roomId}/leave`).set("Authorization", `Bearer ${token}`);

      const response = await request(app)
        .post(`/api/rooms/${roomId}/join`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe("ROOM_ENDED");
    });

    it("host leaving ends the room", async () => {
      const token = await registerAndLogin("host-leave@example.com");
      const createResponse = await request(app)
        .post("/api/rooms")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Host Leave Room" });
      const roomId = createResponse.body.data.id as string;

      const response = await request(app)
        .post(`/api/rooms/${roomId}/leave`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      const detail = await request(app).get(`/api/rooms/${roomId}`).set("Authorization", `Bearer ${token}`);
      expect(detail.body.data.status).toBe("ended");
    });

    it("leaving twice is idempotent, not an error", async () => {
      const token = await registerAndLogin("dup-leave@example.com");
      const createResponse = await request(app)
        .post("/api/rooms")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Dup Leave Room" });
      const roomId = createResponse.body.data.id as string;
      await request(app).post(`/api/rooms/${roomId}/leave`).set("Authorization", `Bearer ${token}`);

      const response = await request(app)
        .post(`/api/rooms/${roomId}/leave`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.participantCount).toBe(0);
    });
  });
});
