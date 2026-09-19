import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";

export const PARTICIPANT_ROLE = { HOST: "host", PARTICIPANT: "participant" } as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLE)[keyof typeof PARTICIPANT_ROLE];

export interface IParticipantSession {
  roomId: Types.ObjectId;
  userId: Types.ObjectId;
  role: ParticipantRole;
  active: boolean;
  joinedAt: Date;
  leftAt?: Date;
  durationSec?: number;
}

export type ParticipantSessionDocument = HydratedDocument<IParticipantSession>;

const participantSessionSchema = new Schema<IParticipantSession>({
  roomId: { type: Schema.Types.ObjectId, ref: "Room", required: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  role: {
    type: String,
    enum: { values: Object.values(PARTICIPANT_ROLE), message: "{VALUE} is not a valid role" },
    required: true,
  },
  active: { type: Boolean, required: true, default: true },
  joinedAt: { type: Date, required: true, default: () => new Date() },
  leftAt: { type: Date },
  durationSec: { type: Number, min: 0 },
});

/**
 * At most one OPEN session per user per room, enforced by the database.
 *
 * The filter keys on `active: true` rather than `leftAt: null` because
 * equality-on-null in a partialFilterExpression conflates a null value with a
 * missing field. Boolean equality has no such ambiguity. Closed sessions fall
 * out of the index, so unlimited history per user per room remains legal.
 *
 * This is the backstop for the idempotent join/leave transitions; the primary
 * guard is the return value of the Redis SADD/SREM.
 */
participantSessionSchema.index(
  { roomId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);

// Serves a user's room history, newest first.
participantSessionSchema.index({ userId: 1, joinedAt: -1 });

export const ParticipantSessionModel: Model<IParticipantSession> = model<IParticipantSession>(
  "ParticipantSession",
  participantSessionSchema,
);
