import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodTypeAny } from "zod";
import { AppError } from "../utils/AppError";

export interface ValidationSchemas {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.validated = {};

    for (const part of ["body", "params", "query"] as const) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part]);
      if (!result.success) {
        next(
          new AppError(
            "VALIDATION_ERROR",
            `Invalid request ${part}`,
            422,
            result.error.flatten().fieldErrors,
          ),
        );
        return;
      }

      req.validated[part] = result.data;
    }

    next();
  };
}

/**
 * Typed readers for validated input. The cast is safe because `validate()`
 * ran first and rejected anything that did not match; centralising it here
 * keeps the assertion to a single audited location.
 */
export const parsedBody = <T>(req: Request): T => req.validated.body as T;
export const parsedParams = <T>(req: Request): T => req.validated.params as T;
export const parsedQuery = <T>(req: Request): T => req.validated.query as T;
