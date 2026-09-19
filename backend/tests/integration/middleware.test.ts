import express from "express";
import request from "supertest";
import { z } from "zod";
import { AppError } from "../../src/utils/AppError";
import { asyncHandler } from "../../src/utils/asyncHandler";
import { requestId } from "../../src/middleware/requestId.middleware";
import { validate, parsedBody } from "../../src/middleware/validate.middleware";
import { errorHandler } from "../../src/middleware/errorHandler.middleware";
import { notFound } from "../../src/middleware/notFound.middleware";

const bodySchema = z.object({ name: z.string().min(3) });

function buildTestApp(): express.Express {
  const app = express();
  app.use(requestId);
  app.use(express.json());

  app.post(
    "/echo",
    validate({ body: bodySchema }),
    asyncHandler((req, res) => {
      res
        .status(200)
        .json({ success: true, message: "OK", data: parsedBody<{ name: string }>(req) });
      return Promise.resolve();
    }),
  );

  app.get(
    "/boom",
    asyncHandler(() => Promise.reject(new AppError("TEAPOT", "I am a teapot", 418))),
  );

  app.get(
    "/unknown-boom",
    asyncHandler(() => Promise.reject(new Error("leaky internal detail"))),
  );

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

describe("middleware stack", () => {
  const app = buildTestApp();

  it("attaches a correlation id to the response", async () => {
    const response = await request(app).get("/health-does-not-exist");

    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
  });

  it("passes a valid body through and exposes it via parsedBody", async () => {
    const response = await request(app).post("/echo").send({ name: "Nikhil" });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ name: "Nikhil" });
  });

  it("rejects an invalid body with 422 and a field-level error map", async () => {
    const response = await request(app).post("/echo").send({ name: "no" });

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(response.body.errors).toHaveProperty("name");
  });

  it("rejects a Mongo operator injection attempt at the boundary", async () => {
    const response = await request(app)
      .post("/echo")
      .send({ name: { $gt: "" } });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("renders an AppError with its own code and status", async () => {
    const response = await request(app).get("/boom");

    expect(response.status).toBe(418);
    expect(response.body).toMatchObject({
      success: false,
      code: "TEAPOT",
      message: "I am a teapot",
    });
  });

  it("never leaks the message of an unexpected error", async () => {
    const response = await request(app).get("/unknown-boom");

    expect(response.status).toBe(500);
    expect(response.body.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(response.body)).not.toContain("leaky internal detail");
  });

  it("returns a 404 envelope for an unmatched route", async () => {
    const response = await request(app).get("/nope");

    expect(response.status).toBe(404);
    expect(response.body.code).toBe("NOT_FOUND");
  });
});
