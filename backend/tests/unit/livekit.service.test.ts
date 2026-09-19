import jwt from "jsonwebtoken";
import { generateToken } from "../../src/modules/livekit/livekit.service";
import { env } from "../../src/config/env";

interface DecodedGrant {
  video?: {
    roomJoin?: boolean;
    room?: string;
    canPublish?: boolean;
    canSubscribe?: boolean;
    canPublishData?: boolean;
    roomAdmin?: boolean;
  };
}

describe("livekit.service", () => {
  it("grants a host publish, subscribe, data and room-admin rights", async () => {
    const result = await generateToken({
      participantId: "user-1",
      participantName: "Host User",
      roomName: "room-1",
      role: "host",
    });

    expect(result.serverUrl).toBe(env.LIVEKIT_URL);
    expect(result.roomName).toBe("room-1");

    const decoded = jwt.decode(result.token) as DecodedGrant;
    expect(decoded.video).toMatchObject({
      roomJoin: true,
      room: "room-1",
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: true,
    });
  });

  it("grants a participant publish and subscribe but NOT room-admin", async () => {
    const result = await generateToken({
      participantId: "user-2",
      participantName: "Guest User",
      roomName: "room-1",
      role: "participant",
    });

    const decoded = jwt.decode(result.token) as DecodedGrant;
    expect(decoded.video).toMatchObject({
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    expect(decoded.video?.roomAdmin).not.toBe(true);
  });

  it("sets the token subject to the participant id, not a caller-supplied name collision", async () => {
    const result = await generateToken({
      participantId: "user-3",
      participantName: "Someone Else Entirely",
      roomName: "room-1",
      role: "participant",
    });

    const decoded = jwt.decode(result.token) as { sub?: string };
    expect(decoded.sub).toBe("user-3");
  });
});
