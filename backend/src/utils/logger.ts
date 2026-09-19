import pino from "pino";
import { env } from "../config/env";

/** Exported so tests can build an isolated logger instance with the same
 * redaction behaviour, pointed at a capturing stream instead of stdout. */
export const redactOptions = {
  paths: ["*.password", "*.passwordHash"],
  censor: "[redacted]",
};

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "lvs-streaming-backend" },
  redact: redactOptions,
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } }
      : undefined,
});
