import request from "supertest";
import { createApp } from "../../src/app";

describe("GET /health", () => {
  it("returns 200 with an ok status and a numeric uptime", async () => {
    const response = await request(createApp()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(typeof response.body.uptime).toBe("number");
  });

  it("does not use the API response envelope", async () => {
    const response = await request(createApp()).get("/health");

    expect(response.body).not.toHaveProperty("success");
  });
});
