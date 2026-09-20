import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";

export interface IRefreshToken {
  userId: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  revokedAt?: Date;
  replacedByTokenHash?: string;
  createdAt: Date;
}

export type RefreshTokenDocument = HydratedDocument<IRefreshToken>;

const refreshTokenSchema = new Schema<IRefreshToken>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  // Only a SHA-256 digest of the token is ever stored — the raw value exists
  // only in the client's hands and in transit, same principle as passwordHash.
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date },
  replacedByTokenHash: { type: String },
  createdAt: { type: Date, default: () => new Date() },
});

// MongoDB drops the document once expiresAt passes, so rotation history needs
// no manual cleanup job. A revoked-but-not-yet-expired token is kept on
// purpose: reuse of a token already rotated away must still be detectable for
// the rest of its original lifetime.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Serves revoking every token in a user's family at once on reuse detection.
refreshTokenSchema.index({ userId: 1 });

export const RefreshTokenModel: Model<IRefreshToken> = model<IRefreshToken>(
  "RefreshToken",
  refreshTokenSchema,
);
