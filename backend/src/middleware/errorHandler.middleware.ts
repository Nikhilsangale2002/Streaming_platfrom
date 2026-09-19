import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { AppError } from "../utils/AppError";
import { env } from "../config/env";

interface ErrorEnvelope {
  success: false;
  code: string;
  message: string;
  errors?: unknown;
}

/** Translates driver-level failures into application errors. */
function normalise(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof mongoose.Error.ValidationError) {
    const fields = Object.fromEntries(
      Object.entries(error.errors).map(([field, issue]) => [field, issue.message]),
    );
    return new AppError("VALIDATION_ERROR", "Invalid request payload", 422, fields);
  }

  if (error instanceof mongoose.Error.CastError) {
    return new AppError("INVALID_IDENTIFIER", `Invalid value for ${error.path}`, 400);
  }

  if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
    return new AppError("DUPLICATE_RESOURCE", "That resource already exists", 409);
  }

  if (
    error instanceof SyntaxError &&
    "status" in error &&
    typeof error.status === "number" &&
    error.status < 500
  ) {
    return new AppError("INVALID_JSON", "Request body is not valid JSON", 400);
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.too.large"
  ) {
    return new AppError("PAYLOAD_TOO_LARGE", "Request body is too large", 413);
  }

  return new AppError("INTERNAL_ERROR", "Something went wrong", 500);
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const appError = normalise(error);

  // `req.log` is set by requestId, which always runs first in app.ts. The
  // optional chaining covers unit tests that mount this handler in isolation.
  if (appError.status >= 500) {
    req.log?.error({ err: error, code: appError.code }, "unhandled error");
  } else {
    req.log?.warn({ code: appError.code, status: appError.status }, appError.message);
  }

  const envelope: ErrorEnvelope = {
    success: false,
    code: appError.code,
    message: appError.message,
  };

  if (appError.details !== undefined) {
    envelope.errors = appError.details;
  }

  // Stacks are a development affordance; they never travel to a client in
  // production, where they disclose file paths and dependency versions.
  if (env.NODE_ENV === "development" && appError.status >= 500 && error instanceof Error) {
    envelope.errors = { stack: error.stack };
  }

  res.status(appError.status).json(envelope);
}
