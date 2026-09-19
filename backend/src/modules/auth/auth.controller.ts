import type { Request, Response } from "express";
import { UserModel } from "../../models/user.model";
import { AppError } from "../../utils/AppError";
import { ok } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { parsedBody } from "../../middleware/validate.middleware";
import { hashPassword, comparePassword, signAccessToken } from "./auth.service";
import type { RegisterInput, LoginInput } from "./auth.schema";

function toUserDto(user: { _id: unknown; name: string; email: string; profileImage?: string }) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    profileImage: user.profileImage,
  };
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const input = parsedBody<RegisterInput>(req);

  const passwordHash = await hashPassword(input.password);
  const user = await UserModel.create({
    name: input.name,
    email: input.email,
    passwordHash,
    profileImage: input.profileImage,
  });

  const token = signAccessToken(user._id.toString());
  res.status(201).json(ok({ user: toUserDto(user), token }, "Registered"));
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const input = parsedBody<LoginInput>(req);

  const user = await UserModel.findOne({ email: input.email }).select("+passwordHash");
  if (!user || !(await comparePassword(input.password, user.passwordHash))) {
    throw new AppError("INVALID_CREDENTIALS", "Email or password is incorrect", 401);
  }

  const token = signAccessToken(user._id.toString());
  res.status(200).json(ok({ user: toUserDto(user), token }, "Logged in"));
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  // requireAuth already guarantees req.user is set for this route.
  const authUser = req.user!;
  const user = await UserModel.findById(authUser.id);
  if (!user) throw new AppError("USER_NOT_FOUND", "User not found", 404);

  res.status(200).json(ok(toUserDto(user)));
});
