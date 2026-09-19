import type { Request, Response } from "express";
import { Types } from "mongoose";
import { RoomModel } from "../../models/room.model";
import { AppError } from "../../utils/AppError";
import { ok } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { parsedBody } from "../../middleware/validate.middleware";
import type { WebhookEvent } from "livekit-server-sdk";
import { generateToken, verifyWebhookEvent } from "./livekit.service";
import type { TokenRequestInput } from "./livekit.schema";
import { redis } from "../../db/redis";
import { redisKeys, WEBHOOK_DEDUPE_TTL_SECONDS } from "../../config/constants";
import { leave } from "../rooms/room.state.service";
import { logger } from "../../utils/logger";

export const issueToken = asyncHandler(async (req: Request, res: Response) => {
  const input = parsedBody<TokenRequestInput>(req);
  const authenticatedUserId = req.user!.id;

  // The identity-spoofing guard: a caller-supplied userId that disagrees
  // with the verified JWT is rejected outright, regardless of the brief's
  // example request shape carrying userId for compatibility.
  if (input.userId !== authenticatedUserId) {
    throw new AppError("IDENTITY_MISMATCH", "userId does not match the authenticated user", 403);
  }

  let room = null;
  if (Types.ObjectId.isValid(input.roomName)) {
    room = await RoomModel.findById(input.roomName);
  }
  room ??= await RoomModel.findOne({ name: input.roomName });
  if (!room) throw new AppError("ROOM_NOT_FOUND", "Room not found", 404);

  // Role is derived from room.host, never trusted from the request body.
  const role = String(room.host) === authenticatedUserId ? "host" : "participant";

  const result = await generateToken({
    participantId: authenticatedUserId,
    participantName: req.user!.name,
    roomName: room._id.toString(),
    role,
  });

  res.status(200).json(ok(result));
});

export const receiveWebhook = asyncHandler(async (req: Request, res: Response) => {
  const rawBody = req.body as string; // express.text() on this route, not express.json()

  let event: WebhookEvent;
  try {
    event = await verifyWebhookEvent(rawBody, req.header("authorization"));
  } catch {
    throw new AppError("INVALID_SIGNATURE", "Webhook signature verification failed", 401);
  }

  const eventId =
    event.id ??
    `${event.event}:${event.room?.name ?? ""}:${event.participant?.identity ?? ""}:${String(event.createdAt ?? "")}`;

  // Claim the event id atomically. A failed claim means "already processed" --
  // acknowledge with 200 and do nothing further. This is the idempotency
  // guard: reconciliation logic below runs at most once per event id, no
  // matter how many times LiveKit retries delivery.
  const claimed = await redis.set(redisKeys.webhookEvent(eventId), "1", "EX", WEBHOOK_DEDUPE_TTL_SECONDS, "NX");
  if (claimed !== "OK") {
    res.status(200).json(ok(null, "Already processed"));
    return;
  }

  // Reconcile, never mutate: compute desired state from the event and
  // converge, rather than incrementing/decrementing a counter. A triple
  // delivered participant_left must not drive anything negative -- leave()
  // is already idempotent for exactly this reason.
  try {
    if (event.event === "participant_left" && event.room?.name && event.participant?.identity) {
      const room =
        (await RoomModel.findById(event.room.name).catch(() => null)) ??
        (await RoomModel.findOne({ name: event.room.name }));
      if (room) {
        await leave({ roomId: room._id.toString(), userId: event.participant.identity, reason: "livekit" });
      }
    }
  } catch (error: unknown) {
    // A reconciliation failure must not fail the webhook response -- LiveKit
    // would retry, and the event id is already claimed, so a retry would be
    // silently dropped by the dedupe guard above rather than fixing anything.
    logger.error({ err: error, eventId, event: event.event }, "webhook reconciliation failed");
  }

  res.status(200).json(ok(null, "Processed"));
});
