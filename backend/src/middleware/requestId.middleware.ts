import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger";

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  req.id = incoming && incoming.length > 0 ? incoming : randomUUID();
  req.log = logger.child({ requestId: req.id });
  res.setHeader("x-request-id", req.id);
  next();
}
