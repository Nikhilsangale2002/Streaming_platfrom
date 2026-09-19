import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/AppError";

export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError("NOT_FOUND", `Route ${req.method} ${req.originalUrl} not found`, 404));
}
