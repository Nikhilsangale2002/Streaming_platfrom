import mongoose from "mongoose";
import { withTestDatabases } from "../helpers/db";
import { UserModel } from "../../src/models/user.model";
import { RoomModel, type IRoom } from "../../src/models/room.model";
import { ParticipantSessionModel } from "../../src/models/participantSession.model";

describe("models", () => {
  withTestDatabases();

  describe("User", () => {
    it("persists a valid user and never exposes passwordHash by default", async () => {
      await UserModel.create({
        name: "Nikhil",
        email: "Nikhil@Example.COM",
        passwordHash: "hashed",
      });

      const found = await UserModel.findOne({ email: "nikhil@example.com" });

      expect(found).not.toBeNull();
      expect(found?.name).toBe("Nikhil");
      // email is lowercased by the schema
      expect(found?.email).toBe("nikhil@example.com");
      expect(found?.passwordHash).toBeUndefined();
    });

    it("returns passwordHash only when explicitly selected", async () => {
      await UserModel.create({ name: "Nikhil", email: "a@b.com", passwordHash: "hashed" });

      const found = await UserModel.findOne({ email: "a@b.com" }).select("+passwordHash");

      expect(found?.passwordHash).toBe("hashed");
    });

    it("rejects a duplicate email with code 11000", async () => {
      await UserModel.create({ name: "One", email: "dupe@example.com", passwordHash: "h" });

      await expect(
        UserModel.create({ name: "Two", email: "dupe@example.com", passwordHash: "h" }),
      ).rejects.toMatchObject({ code: 11000 });
    });

    it("rejects a name shorter than two characters", async () => {
      await expect(
        UserModel.create({ name: "N", email: "n@example.com", passwordHash: "h" }),
      ).rejects.toBeInstanceOf(mongoose.Error.ValidationError);
    });

    it("has no isOnline field — presence lives in Redis", () => {
      expect(UserModel.schema.path("isOnline")).toBeUndefined();
    });
  });

  describe("Room", () => {
    it("defaults to live status and the configured capacity", async () => {
      const host = await UserModel.create({ name: "Host", email: "h@e.com", passwordHash: "h" });
      const room = await RoomModel.create({ name: "Morning Show", host: host._id });

      expect(room.status).toBe("live");
      expect(room.maxParticipants).toBe(50);
      expect(room.createdAt).toBeInstanceOf(Date);
    });

    it("rejects an unknown status", async () => {
      const host = await UserModel.create({ name: "Host", email: "h2@e.com", passwordHash: "h" });

      // The cast is the point of the test: it forces a value past the compile-time
      // union to prove the schema enum rejects it at runtime too.
      const invalid = { name: "Bad Room", host: host._id, status: "paused" } as unknown as IRoom;

      await expect(RoomModel.create(invalid)).rejects.toBeInstanceOf(
        mongoose.Error.ValidationError,
      );
    });

    it("indexes status with createdAt descending for the active-room listing", () => {
      const indexes = RoomModel.schema.indexes().map(([fields]) => fields);

      expect(indexes).toContainEqual({ status: 1, createdAt: -1 });
    });

    it("stores no participants or participantCount — Redis owns live membership", () => {
      expect(RoomModel.schema.path("participants")).toBeUndefined();
      expect(RoomModel.schema.path("participantCount")).toBeUndefined();
    });
  });

  describe("ParticipantSession", () => {
    it("allows only one active session per user per room", async () => {
      const user = await UserModel.create({ name: "Us", email: "u@e.com", passwordHash: "h" });
      const host = await UserModel.create({ name: "Ho", email: "h3@e.com", passwordHash: "h" });
      const room = await RoomModel.create({ name: "Room", host: host._id });
      await ParticipantSessionModel.syncIndexes();

      await ParticipantSessionModel.create({
        roomId: room._id,
        userId: user._id,
        role: "participant",
        active: true,
      });

      await expect(
        ParticipantSessionModel.create({
          roomId: room._id,
          userId: user._id,
          role: "participant",
          active: true,
        }),
      ).rejects.toMatchObject({ code: 11000 });
    });

    it("allows many closed sessions for the same user and room", async () => {
      const user = await UserModel.create({ name: "Us", email: "u2@e.com", passwordHash: "h" });
      const host = await UserModel.create({ name: "Ho", email: "h4@e.com", passwordHash: "h" });
      const room = await RoomModel.create({ name: "Room", host: host._id });
      await ParticipantSessionModel.syncIndexes();

      await ParticipantSessionModel.create({
        roomId: room._id,
        userId: user._id,
        role: "participant",
        active: false,
        leftAt: new Date(),
      });

      await expect(
        ParticipantSessionModel.create({
          roomId: room._id,
          userId: user._id,
          role: "participant",
          active: false,
          leftAt: new Date(),
        }),
      ).resolves.toBeDefined();
    });
  });
});
