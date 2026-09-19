import express, { type Express, type Request, type Response } from "express";

/**
 * Builds the Express application without binding a port, so integration tests
 * can drive it through supertest while `server.ts` owns the HTTP lifecycle.
 */
export function createApp(): Express {
  const app = express();

  // Deliberately outside the API response envelope: this endpoint is consumed
  // by the Docker healthcheck and the load balancer, not by API clients.
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok", uptime: process.uptime() });
  });

  return app;
}
