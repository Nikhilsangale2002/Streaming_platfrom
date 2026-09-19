import type { NextFunction, Request, RequestHandler, Response } from "express";

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/**
 * Express 5 forwards rejected promises to the error handler on its own, but
 * wrapping keeps the intent explicit and the behaviour identical if the
 * handler is ever mounted on an Express 4 router.
 */
export function asyncHandler(handler: AsyncRouteHandler): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}
