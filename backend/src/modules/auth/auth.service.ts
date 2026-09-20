import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { AppError } from "../../utils/AppError";
import { RefreshTokenModel } from "../../models/refreshToken.model";

const BCRYPT_COST = 12;
const REFRESH_TOKEN_BYTES = 64;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface AccessTokenPayload {
  sub: string;
}

/**
 * `expiresIn` is exposed only for the "0s" expired-token test above; every
 * real caller relies on the default from JWT_EXPIRES_IN (1h). Typed as
 * `jwt.SignOptions["expiresIn"]` (string | number) rather than plain
 * `string` so that test's numeric override type-checks.
 */
export function signAccessToken(userId: string, expiresIn?: jwt.SignOptions["expiresIn"]): string {
  const payload: AccessTokenPayload = { sub: userId };
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: (expiresIn ?? env.JWT_EXPIRES_IN) as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === "string" || typeof decoded.sub !== "string") {
    throw new Error("Malformed token payload");
  }
  return { sub: decoded.sub };
}

/**
 * Refresh tokens are opaque, high-entropy random strings, not JWTs. Only a
 * SHA-256 digest is ever persisted (same principle as passwordHash), and
 * unlike a self-verifying JWT, an opaque token can actually be revoked —
 * which a rotation scheme depends on.
 */
function hashRefreshToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function refreshTokenExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export async function issueRefreshToken(userId: string): Promise<string> {
  const rawToken = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString("hex");
  await RefreshTokenModel.create({
    userId,
    tokenHash: hashRefreshToken(rawToken),
    expiresAt: refreshTokenExpiry(),
  });
  return rawToken;
}

export interface RotatedTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Rotates a refresh token one-for-one: the presented token is revoked and a
 * fresh one takes its place. Presenting a token that's already revoked (i.e.
 * used a second time after it was rotated away) revokes every other live
 * token for that user — the strongest signal available, without extra
 * infrastructure, that the token was stolen and is being used out from under
 * its actual owner.
 */
export async function rotateRefreshToken(rawToken: string): Promise<RotatedTokens> {
  const tokenHash = hashRefreshToken(rawToken);
  const stored = await RefreshTokenModel.findOne({ tokenHash });

  if (!stored || stored.expiresAt.getTime() <= Date.now()) {
    throw new AppError("INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired", 401);
  }

  if (stored.revokedAt) {
    await RefreshTokenModel.updateMany(
      { userId: stored.userId, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } },
    );
    throw new AppError("REFRESH_TOKEN_REUSED", "Refresh token was already used", 401);
  }

  const userId = stored.userId.toString();
  const newRawToken = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString("hex");

  stored.revokedAt = new Date();
  stored.replacedByTokenHash = hashRefreshToken(newRawToken);
  await stored.save();

  await RefreshTokenModel.create({
    userId,
    tokenHash: stored.replacedByTokenHash,
    expiresAt: refreshTokenExpiry(),
  });

  return { accessToken: signAccessToken(userId), refreshToken: newRawToken };
}

/** Idempotent: revoking an already-revoked or unknown token is a no-op. */
export async function revokeRefreshToken(rawToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(rawToken);
  await RefreshTokenModel.updateOne(
    { tokenHash, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
}
