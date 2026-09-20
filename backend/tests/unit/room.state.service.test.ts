import { withTestDatabases } from "../helpers/db";
import { UserModel } from "../../src/models/user.model";
import { RoomModel, ROOM_STATUS } from "../../src/models/room.model";
import { ParticipantSessionModel } from "../../src/models/participantSession.model";
import { join, leave, getParticipantCount, getParticipantIds } from "../../src/modules/rooms/room.state.service";

async function makeRoom() {
  const host = await UserModel.create({ name: "Host", email: `h${Date.now()}@e.com`, passwordHash: "h" });
  const room = await RoomModel.create({ name: "Test Room", host: host._id });
  return { room, host };
}

describe("room.state.service", () => {
  withTestDatabases();

  describe("join", () => {
    it("adds a participant and opens a ParticipantSession", async () => {
      const { room, host } = await makeRoom();

      const result = await join({ roomId: room._id.toString(), userId: host._id.toString(), role: "host" });

      expect(result.joined).toBe(true);
      expect(result.participantCount).toBe(1);
      const session = await ParticipantSessionModel.findOne({ roomId: room._id, userId: host._id });
      expect(session?.active).toBe(true);
    });

    it("is idempotent: joining twice does not double-count", async () => {
      const { room, host } = await makeRoom();

      await join({ roomId: room._id.toString(), userId: host._id.toString(), role: "host" });
      const second = await join({ roomId: room._id.toString(), userId: host._id.toString(), role: "host" });

      expect(second.joined).toBe(false);
      await expect(getParticipantCount(room._id.toString())).resolves.toBe(1);
    });

    it("rejects joining an ended room with ROOM_ENDED", async () => {
      const { room, host } = await makeRoom();
      await RoomModel.updateOne({ _id: room._id }, { status: ROOM_STATUS.ENDED, endedAt: new Date() });

      await expect(
        join({ roomId: room._id.toString(), userId: host._id.toString(), role: "host" }),
      ).rejects.toMatchObject({ code: "ROOM_ENDED" });
    });

    it("rejects joining a full room with ROOM_FULL", async () => {
      const { room, host } = await makeRoom();
      await RoomModel.updateOne({ _id: room._id }, { maxParticipants: 1 });
      await join({ roomId: room._id.toString(), userId: host._id.toString(), role: "host" });

      const guest = await UserModel.create({ name: "Guest", email: "g@e.com", passwordHash: "h" });
      await expect(
        join({ roomId: room._id.toString(), userId: guest._id.toString(), role: "participant" }),
      ).rejects.toMatchObject({ code: "ROOM_FULL" });
    });
  });

  describe("leave", () => {
    it("removes a participant and closes the ParticipantSession", async () => {
      const { room, host } = await makeRoom();
      await join({ roomId: room._id.toString(), userId: host._id.toString(), role: "host" });

      const result = await leave({ roomId: room._id.toString(), userId: host._id.toString(), reason: "rest" });

      expect(result.left).toBe(true);
      expect(result.participantCount).toBe(0);
      const session = await ParticipantSessionModel.findOne({ roomId: room._id, userId: host._id });
      expect(session?.active).toBe(false);
      expect(session?.leftAt).toBeInstanceOf(Date);
      expect(session?.durationSec).toBeGreaterThanOrEqual(0);
    });

    it("is idempotent: leaving twice is a no-op the second time", async () => {
      const { room, host } = await makeRoom();
      await join({ roomId: room._id.toString(), userId: host._id.toString(), role: "host" });

      await leave({ roomId: room._id.toString(), userId: host._id.toString(), reason: "rest" });
      const second = await leave({ roomId: room._id.toString(), userId: host._id.toString(), reason: "rest" });

      expect(second.left).toBe(false);
      expect(second.participantCount).toBe(0);
    });

    it("ends the room when the host leaves", async () => {
      const { room, host } = await makeRoom();
      await join({ roomId: room._id.toString(), userId: host._id.toString(), role: "host" });

      const result = await leave({ roomId: room._id.toString(), userId: host._id.toString(), reason: "rest" });

      expect(result.roomEnded).toBe(true);
      const updated = await RoomModel.findById(room._id);
      expect(updated?.status).toBe(ROOM_STATUS.ENDED);
      expect(updated?.endedAt).toBeInstanceOf(Date);
    });

    it("does not end the room when a non-host participant leaves", async () => {
      const { room, host } = await makeRoom();
      await join({ roomId: room._id.toString(), userId: host._id.toString(), role: "host" });
      const guest = await UserModel.create({ name: "Guest", email: "g2@e.com", passwordHash: "h" });
      await join({ roomId: room._id.toString(), userId: guest._id.toString(), role: "participant" });

      const result = await leave({ roomId: room._id.toString(), userId: guest._id.toString(), reason: "socket" });

      expect(result.roomEnded).toBe(false);
      await expect(getParticipantIds(room._id.toString())).resolves.toEqual([host._id.toString()]);
    });

    it("converges every remaining participant when the host leaving ends the room", async () => {
      const { room, host } = await makeRoom();
      await join({ roomId: room._id.toString(), userId: host._id.toString(), role: "host" });
      const guest = await UserModel.create({ name: "Guest2", email: "g3@e.com", passwordHash: "h" });
      await join({ roomId: room._id.toString(), userId: guest._id.toString(), role: "participant" });

      const result = await leave({ roomId: room._id.toString(), userId: host._id.toString(), reason: "rest" });

      expect(result.roomEnded).toBe(true);
      await expect(getParticipantCount(room._id.toString())).resolves.toBe(0);

      const guestSession = await ParticipantSessionModel.findOne({ roomId: room._id, userId: guest._id });
      expect(guestSession?.active).toBe(false);
      expect(guestSession?.leftAt).toBeInstanceOf(Date);
      expect(guestSession?.durationSec).toBeGreaterThanOrEqual(0);
    });

    it("simultaneous leave calls for the same user close exactly one ParticipantSession", async () => {
      const { room, host } = await makeRoom();
      await join({ roomId: room._id.toString(), userId: host._id.toString(), role: "host" });

      const [a, b] = await Promise.all([
        leave({ roomId: room._id.toString(), userId: host._id.toString(), reason: "rest" }),
        leave({ roomId: room._id.toString(), userId: host._id.toString(), reason: "disconnect" }),
      ]);

      // Exactly one of the two calls performed the transition.
      expect([a.left, b.left].filter(Boolean)).toHaveLength(1);
      const sessions = await ParticipantSessionModel.find({ roomId: room._id, userId: host._id });
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.active).toBe(false);
    });
  });
});
