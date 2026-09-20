import request from "supertest";
import { createApp } from "../../src/app";
import { withTestDatabases } from "../helpers/db";
import { UserModel } from "../../src/models/user.model";

describe("auth routes", () => {
  withTestDatabases();
  const app = createApp();

  describe("POST /api/auth/register", () => {
    it("creates a user and returns a token", async () => {
      const response = await request(app)
        .post("/api/auth/register")
        .send({ name: "Nikhil", email: "nikhil@example.com", password: "correct-horse" });

      expect(response.status).toBe(201);
      expect(response.body.data.user.email).toBe("nikhil@example.com");
      expect(response.body.data.user).not.toHaveProperty("passwordHash");
      expect(typeof response.body.data.token).toBe("string");
      expect(typeof response.body.data.refreshToken).toBe("string");
    });

    it("rejects a duplicate email with 409", async () => {
      await request(app)
        .post("/api/auth/register")
        .send({ name: "One", email: "dupe@example.com", password: "correct-horse" });

      const response = await request(app)
        .post("/api/auth/register")
        .send({ name: "Two", email: "dupe@example.com", password: "correct-horse" });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe("DUPLICATE_RESOURCE");
    });

    it("rejects a short password with 422", async () => {
      const response = await request(app)
        .post("/api/auth/register")
        .send({ name: "Nikhil", email: "short@example.com", password: "abc" });

      expect(response.status).toBe(422);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("POST /api/auth/login", () => {
    beforeEach(async () => {
      await request(app)
        .post("/api/auth/register")
        .send({ name: "Login User", email: "login@example.com", password: "correct-horse" });
    });

    it("logs in with correct credentials", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send({ email: "login@example.com", password: "correct-horse" });

      expect(response.status).toBe(200);
      expect(typeof response.body.data.token).toBe("string");
      expect(typeof response.body.data.refreshToken).toBe("string");
    });

    it("rejects the wrong password with 401", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send({ email: "login@example.com", password: "wrong-password" });

      expect(response.status).toBe(401);
      expect(response.body.code).toBe("INVALID_CREDENTIALS");
    });
  });

  describe("POST /api/auth/refresh", () => {
    it("exchanges a valid refresh token for a new access + refresh token pair", async () => {
      const registerResponse = await request(app)
        .post("/api/auth/register")
        .send({ name: "Refresh User", email: "refresh@example.com", password: "correct-horse" });
      const { refreshToken } = registerResponse.body.data as { refreshToken: string };

      const response = await request(app).post("/api/auth/refresh").send({ refreshToken });

      expect(response.status).toBe(200);
      expect(typeof response.body.data.accessToken).toBe("string");
      expect(typeof response.body.data.refreshToken).toBe("string");
      expect(response.body.data.refreshToken).not.toBe(refreshToken);
    });

    it("rejects reuse of an already-rotated refresh token", async () => {
      const registerResponse = await request(app)
        .post("/api/auth/register")
        .send({ name: "Reuse User", email: "reuse@example.com", password: "correct-horse" });
      const { refreshToken } = registerResponse.body.data as { refreshToken: string };

      await request(app).post("/api/auth/refresh").send({ refreshToken });
      const secondAttempt = await request(app).post("/api/auth/refresh").send({ refreshToken });

      expect(secondAttempt.status).toBe(401);
      expect(secondAttempt.body.code).toBe("REFRESH_TOKEN_REUSED");
    });

    it("rejects an unknown refresh token with 401", async () => {
      const response = await request(app).post("/api/auth/refresh").send({ refreshToken: "bogus" });

      expect(response.status).toBe(401);
      expect(response.body.code).toBe("INVALID_REFRESH_TOKEN");
    });

    it("rejects a missing refresh token with 422", async () => {
      const response = await request(app).post("/api/auth/refresh").send({});

      expect(response.status).toBe(422);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("POST /api/auth/logout", () => {
    it("revokes the refresh token so it can no longer be used", async () => {
      const registerResponse = await request(app)
        .post("/api/auth/register")
        .send({ name: "Logout User", email: "logout@example.com", password: "correct-horse" });
      const { refreshToken } = registerResponse.body.data as { refreshToken: string };

      const logoutResponse = await request(app).post("/api/auth/logout").send({ refreshToken });
      expect(logoutResponse.status).toBe(200);

      const refreshAttempt = await request(app).post("/api/auth/refresh").send({ refreshToken });
      expect(refreshAttempt.status).toBe(401);
    });

    it("is idempotent — logging out twice is still a 200", async () => {
      const registerResponse = await request(app)
        .post("/api/auth/register")
        .send({ name: "Twice User", email: "twice@example.com", password: "correct-horse" });
      const { refreshToken } = registerResponse.body.data as { refreshToken: string };

      await request(app).post("/api/auth/logout").send({ refreshToken });
      const secondLogout = await request(app).post("/api/auth/logout").send({ refreshToken });

      expect(secondLogout.status).toBe(200);
    });

    it("logging out with an unknown token is still a 200, not an error", async () => {
      const response = await request(app).post("/api/auth/logout").send({ refreshToken: "never-issued" });
      expect(response.status).toBe(200);
    });
  });

  describe("GET /api/users/me", () => {
    it("returns 401 without a token", async () => {
      const response = await request(app).get("/api/users/me");
      expect(response.status).toBe(401);
    });

    it("returns 401 for a malformed token", async () => {
      const response = await request(app)
        .get("/api/users/me")
        .set("Authorization", "Bearer not-a-real-token");
      expect(response.status).toBe(401);
    });

    it("returns the current user for a valid token", async () => {
      const registerResponse = await request(app)
        .post("/api/auth/register")
        .send({ name: "Me User", email: "me@example.com", password: "correct-horse" });
      const token = registerResponse.body.data.token as string;

      const response = await request(app).get("/api/users/me").set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.email).toBe("me@example.com");
    });

    it("returns 401 when the user was deleted after the token was issued", async () => {
      const registerResponse = await request(app)
        .post("/api/auth/register")
        .send({ name: "Deleted", email: "deleted@example.com", password: "correct-horse" });
      const token = registerResponse.body.data.token as string;
      await UserModel.deleteOne({ email: "deleted@example.com" });

      const response = await request(app).get("/api/users/me").set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(401);
    });
  });
});
