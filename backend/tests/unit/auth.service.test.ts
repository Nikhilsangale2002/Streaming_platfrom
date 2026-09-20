import {
  hashPassword,
  comparePassword,
  signAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
} from "../../src/modules/auth/auth.service";
import { RefreshTokenModel } from "../../src/models/refreshToken.model";
import { withTestDatabases } from "../helpers/db";

describe("auth.service", () => {
  describe("password hashing", () => {
    it("produces a hash that verifies against the original password", async () => {
      const hash = await hashPassword("correct horse battery staple");

      expect(hash).not.toBe("correct horse battery staple");
      await expect(comparePassword("correct horse battery staple", hash)).resolves.toBe(true);
    });

    it("rejects the wrong password", async () => {
      const hash = await hashPassword("correct horse battery staple");

      await expect(comparePassword("wrong password", hash)).resolves.toBe(false);
    });
  });

  describe("JWT", () => {
    it("round-trips a user id through sign and verify", () => {
      const token = signAccessToken("507f1f77bcf86cd799439011");
      const payload = verifyAccessToken(token);

      expect(payload.sub).toBe("507f1f77bcf86cd799439011");
    });

    it("throws on a tampered token", () => {
      const token = signAccessToken("507f1f77bcf86cd799439011");
      const tampered = token.slice(0, -4) + "abcd";

      expect(() => verifyAccessToken(tampered)).toThrow();
    });

    it("throws on an expired token", () => {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- kept verbatim from the brief; signAccessToken's expiresIn also accepts number, making the cast structurally redundant but harmless.
      const token = signAccessToken("507f1f77bcf86cd799439011", "0s" as unknown as number);

      expect(() => verifyAccessToken(token)).toThrow();
    });
  });

  describe("refresh tokens", () => {
    withTestDatabases();
    const userId = "507f1f77bcf86cd799439011";

    it("issues a raw token backed by a stored hash, never the raw value", async () => {
      const rawToken = await issueRefreshToken(userId);

      const stored = await RefreshTokenModel.findOne({ userId });
      expect(stored).not.toBeNull();
      expect(stored!.tokenHash).not.toBe(rawToken);
    });

    it("rotates a valid token and the new token is itself usable", async () => {
      const rawToken = await issueRefreshToken(userId);

      const rotated = await rotateRefreshToken(rawToken);
      expect(typeof rotated.accessToken).toBe("string");
      expect(typeof rotated.refreshToken).toBe("string");
      expect(rotated.refreshToken).not.toBe(rawToken);

      // The new token from rotation is live and can be rotated again in turn.
      const secondRotation = await rotateRefreshToken(rotated.refreshToken);
      expect(typeof secondRotation.accessToken).toBe("string");
      expect(secondRotation.refreshToken).not.toBe(rotated.refreshToken);
    });

    it("rejects reuse of a token that was already rotated away", async () => {
      const rawToken = await issueRefreshToken(userId);
      await rotateRefreshToken(rawToken);

      await expect(rotateRefreshToken(rawToken)).rejects.toMatchObject({ code: "REFRESH_TOKEN_REUSED" });
    });

    it("rejects an unknown token", async () => {
      await expect(rotateRefreshToken("not-a-real-token")).rejects.toMatchObject({
        code: "INVALID_REFRESH_TOKEN",
      });
    });

    it("rejects an expired token", async () => {
      const rawToken = await issueRefreshToken(userId);
      await RefreshTokenModel.updateMany({ userId }, { expiresAt: new Date(Date.now() - 1000) });

      await expect(rotateRefreshToken(rawToken)).rejects.toMatchObject({ code: "INVALID_REFRESH_TOKEN" });
    });

    it("revoking every other live token on reuse stops a stolen token's whole chain", async () => {
      const rawToken = await issueRefreshToken(userId);
      const otherRawToken = await issueRefreshToken(userId);

      const rotated = await rotateRefreshToken(rawToken);
      // Attacker replays the already-rotated-away token.
      await expect(rotateRefreshToken(rawToken)).rejects.toMatchObject({ code: "REFRESH_TOKEN_REUSED" });

      // The legitimate rotated token and the unrelated sibling token are both
      // dead now too — each still exists as a record, just revoked, so
      // presenting either now reports the same "already used" signal.
      await expect(rotateRefreshToken(rotated.refreshToken)).rejects.toMatchObject({
        code: "REFRESH_TOKEN_REUSED",
      });
      await expect(rotateRefreshToken(otherRawToken)).rejects.toMatchObject({
        code: "REFRESH_TOKEN_REUSED",
      });
    });

    it("revokeRefreshToken is idempotent", async () => {
      const rawToken = await issueRefreshToken(userId);

      await revokeRefreshToken(rawToken);
      await expect(revokeRefreshToken(rawToken)).resolves.toBeUndefined();

      await expect(rotateRefreshToken(rawToken)).rejects.toMatchObject({ code: "REFRESH_TOKEN_REUSED" });
    });

    it("revoking an unknown token is a harmless no-op", async () => {
      await expect(revokeRefreshToken("never-issued")).resolves.toBeUndefined();
    });
  });
});
