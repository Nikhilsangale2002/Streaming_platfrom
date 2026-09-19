import pino from "pino";
import { env } from "../config/env";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "lvs-streaming-backend" },
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.passwordHash"],
    censor: "[redacted]",
  },
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } }
      : undefined,
});
