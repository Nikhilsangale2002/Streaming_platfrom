import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validate.middleware";
import { tokenRequestSchema } from "./livekit.schema";
import { issueToken } from "./livekit.controller";

export const livekitRouter = Router();
livekitRouter.post("/token", requireAuth, validate({ body: tokenRequestSchema }), issueToken);
