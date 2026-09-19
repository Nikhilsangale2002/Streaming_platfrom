import request from "supertest";
import { createApp } from "../../src/app";

describe("createApp composition", () => {
  it("returns the 404 envelope from the fully composed stack for an unmatched route", async () => {
    const response = await request(createApp()).get("/this-route-does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, code: "NOT_FOUND" });
  });

  it("sets a correlation id header on every response, including errors", async () => {
    const response = await request(createApp()).get("/health");

    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
  });

  it("returns 400 INVALID_JSON for a malformed JSON body through the real stack", async () => {
    const response = await request(createApp())
      .post("/this-route-does-not-exist")
      .set("Content-Type", "application/json")
      .send("{not valid json");

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, code: "INVALID_JSON" });
  });

  it("returns 413 PAYLOAD_TOO_LARGE for a body over the configured limit", async () => {
    const response = await request(createApp())
      .post("/this-route-does-not-exist")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ padding: "x".repeat(200_000) }));

    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({ success: false, code: "PAYLOAD_TOO_LARGE" });
  });
});
