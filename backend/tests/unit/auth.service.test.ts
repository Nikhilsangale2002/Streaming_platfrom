import { hashPassword, comparePassword, signAccessToken, verifyAccessToken } from "../../src/modules/auth/auth.service";

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
});
