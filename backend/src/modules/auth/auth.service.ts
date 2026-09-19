import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";

const BCRYPT_COST = 12;

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
