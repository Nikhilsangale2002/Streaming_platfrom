import cors from "cors";
import express, { type Express, type Request, type Response } from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { errorHandler } from "./middleware/errorHandler.middleware";
import { notFound } from "./middleware/notFound.middleware";
import { requestId } from "./middleware/requestId.middleware";
import { authRouter, usersRouter } from "./modules/auth/auth.routes";

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");

  app.use(requestId);
  app.use(helmet());
  app.use(
    cors({
      origin: [...env.corsOrigins],
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "100kb" }));

  // Outside the envelope on purpose — read by Docker and the load balancer.
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok", uptime: process.uptime() });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
