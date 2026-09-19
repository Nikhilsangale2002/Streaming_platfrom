import type { NextFunction, Request, Response } from "express";
import { UserModel } from "../models/user.model";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";
import { verifyAccessToken } from "../modules/auth/auth.service";

export const requireAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

  if (!token) {
    next(new AppError("UNAUTHORIZED", "Missing bearer token", 401));
    return;
  }

  let userId: string;
  try {
    userId = verifyAccessToken(token).sub;
  } catch {
    next(new AppError("UNAUTHORIZED", "Invalid or expired token", 401));
    return;
  }

  const user = await UserModel.findById(userId);
  if (!user) {
    next(new AppError("UNAUTHORIZED", "User no longer exists", 401));
    return;
  }

  req.user = { id: user._id.toString(), name: user.name, email: user.email };
  next();
});
