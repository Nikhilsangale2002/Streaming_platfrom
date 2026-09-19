import { Router } from "express";
import { validate } from "../../middleware/validate.middleware";
import { authRateLimiter } from "../../middleware/rateLimit.middleware";
import { requireAuth } from "../../middleware/auth.middleware";
import { registerSchema, loginSchema } from "./auth.schema";
import { register, login, me } from "./auth.controller";

export const authRouter = Router();
authRouter.post("/register", authRateLimiter, validate({ body: registerSchema }), register);
authRouter.post("/login", authRateLimiter, validate({ body: loginSchema }), login);

export const usersRouter = Router();
usersRouter.get("/me", requireAuth, me);
