import http from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createApp } from "../../src/app";
import { attachSocketServer } from "../../src/realtime/io";
import { withTestDatabases } from "../helpers/db";
import { UserModel } from "../../src/models/user.model";
import { signAccessToken } from "../../src/modules/auth/auth.service";
import { RoomModel } from "../../src/models/room.model";
import type { ClientToServerEvents, ServerToClientEvents } from "../../src/realtime/events";

async function startServer() {
  const server = http.createServer(createApp());
  attachSocketServer(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, port };
}

function connectClient(port: number, token: string): ClientSocket<ServerToClientEvents, ClientToServerEvents> {
  return ioClient(`http://localhost:${port}`, { auth: { token }, forceNew: true });
}

function once<K extends keyof ServerToClientEvents>(
  socket: ClientSocket<ServerToClientEvents, ClientToServerEvents>,
  event: K,
): Promise<Parameters<ServerToClientEvents[K]>[0]> {
  return new Promise((resolve) => {
    const listener = (payload: Parameters<ServerToClientEvents[K]>[0]): void => resolve(payload);
    socket.once(event, listener as never);
  });
}

async function makeUserAndToken(email: string) {
  const user = await UserModel.create({ name: "Socket User", email, passwordHash: "h" });
  return { userId: user._id.toString(), token: signAccessToken(user._id.toString()) };
}

describe("Socket.IO realtime layer", () => {
  withTestDatabases();
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    ({ server, port } = await startServer());
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("rejects a connection with no token", async () => {
    const client = connectClient(port, "");
    const error = await new Promise<Error>((resolve) => client.once("connect_error", resolve));
    expect(error.message).toBe("UNAUTHORIZED");
    client.close();
  });

  it("rejects a connection with an invalid token", async () => {
    const client = connectClient(port, "not-a-real-token");
    const error = await new Promise<Error>((resolve) => client.once("connect_error", resolve));
    expect(error.message).toBe("UNAUTHORIZED");
    client.close();
  });

  it("accepts a connection with a valid token", async () => {
    const { token } = await makeUserAndToken("valid@example.com");
    const client = connectClient(port, token);
    await new Promise<void>((resolve) => client.once("connect", resolve));
    expect(client.connected).toBe(true);
    client.close();
  });

  it("joining a room acks ok and broadcasts participant_joined to the room", async () => {
    const host = await makeUserAndToken("join-host@example.com");
    const room = await RoomModel.create({ name: "Socket Room", host: host.userId });

    const hostClient = connectClient(port, host.token);
    await new Promise<void>((resolve) => hostClient.once("connect", resolve));

    const ack = await new Promise<{ ok: boolean }>((resolve) => {
      hostClient.emit("room:join", { roomId: room._id.toString() }, resolve);
    });

    expect(ack.ok).toBe(true);
    hostClient.close();
  });

  it("allows an existing member to re-join a room that is now at capacity", async () => {
    const host = await makeUserAndToken("cap-host@example.com");
    const other = await makeUserAndToken("cap-other@example.com");
    const room = await RoomModel.create({ name: "Capacity Room", host: host.userId, maxParticipants: 2 });

    const hostClient = connectClient(port, host.token);
    await new Promise<void>((resolve) => hostClient.once("connect", resolve));
    const hostAck = await new Promise<{ ok: boolean }>((resolve) => {
      hostClient.emit("room:join", { roomId: room._id.toString() }, resolve);
    });
    expect(hostAck.ok).toBe(true);

    const otherClient = connectClient(port, other.token);
    await new Promise<void>((resolve) => otherClient.once("connect", resolve));
    const otherAck = await new Promise<{ ok: boolean }>((resolve) => {
      otherClient.emit("room:join", { roomId: room._id.toString() }, resolve);
    });
    expect(otherAck.ok).toBe(true); // room is now at capacity: 2/2

    // Re-emitting room:join for an EXISTING member must still succeed even
    // though the room is now full -- capacity only blocks genuinely new
    // members. Before the fix, assertRoomJoinable hardcoded alreadyMember to
    // false and wrongly rejected this with ROOM_FULL.
    const rejoinAck = await new Promise<{ ok: boolean }>((resolve) => {
      hostClient.emit("room:join", { roomId: room._id.toString() }, resolve);
    });
    expect(rejoinAck.ok).toBe(true);

    hostClient.close();
    otherClient.close();
  });

  it("rejects room:message from a socket that has not joined the room", async () => {
    const member = await makeUserAndToken("msg-member@example.com");
    const outsider = await makeUserAndToken("msg-outsider@example.com");
    const room = await RoomModel.create({ name: "Message Room", host: member.userId });

    const memberClient = connectClient(port, member.token);
    await new Promise<void>((resolve) => memberClient.once("connect", resolve));
    await new Promise<{ ok: boolean }>((resolve) => {
      memberClient.emit("room:join", { roomId: room._id.toString() }, resolve);
    });

    const outsiderClient = connectClient(port, outsider.token);
    await new Promise<void>((resolve) => outsiderClient.once("connect", resolve));

    let memberReceived = false;
    memberClient.once("room:message", () => {
      memberReceived = true;
    });

    // Attach the error listener before emitting, per the same
    // listener-before-trigger discipline as the rest of this file.
    const errorPromise = once(outsiderClient, "error");
    outsiderClient.emit("room:message", { roomId: room._id.toString(), text: "should not broadcast" });
    const errorEvent = await errorPromise;

    expect(errorEvent.code).toBe("NOT_A_MEMBER");
    expect(memberReceived).toBe(false);

    memberClient.close();
    outsiderClient.close();
  });

  it("multi-tab: two sockets for one user, one disconnects, user stays online", async () => {
    const { userId, token } = await makeUserAndToken("multitab@example.com");
    const observer = await makeUserAndToken("observer@example.com");

    const observerClient = connectClient(port, observer.token);
    await new Promise<void>((resolve) => observerClient.once("connect", resolve));

    // Attach the listener before triggering the connection that causes the
    // broadcast. A fast localhost Redis round trip can otherwise complete
    // (and the server can emit) before this line would have run, dropping a
    // `.once()` listener that was registered too late -- a test-ordering
    // race, not a production bug.
    const onlinePromise = once(observerClient, "user:online");

    const clientA = connectClient(port, token);
    await new Promise<void>((resolve) => clientA.once("connect", resolve));
    await onlinePromise;

    const clientB = connectClient(port, token);
    await new Promise<void>((resolve) => clientB.once("connect", resolve));

    clientA.close();
    // Give the disconnect handler one real event loop turn via a no-op room
    // join/ack round trip on the surviving socket rather than a timer.
    await new Promise<{ ok: boolean }>((resolve) => {
      clientB.emit("room:join", { roomId: "000000000000000000000000" }, () => resolve({ ok: true }));
    });

    const { isOnline } = await import("../../src/modules/presence/presence.service");
    await expect(isOnline(userId)).resolves.toBe(true);

    clientB.close();
    observerClient.close();
  });

  it("disconnect triggers the shared leave() path and ends the room if the host disconnects", async () => {
    const host = await makeUserAndToken("disc-host@example.com");
    const room = await RoomModel.create({ name: "Disc Room", host: host.userId });
    const { join } = await import("../../src/modules/rooms/room.state.service");
    await join({ roomId: room._id.toString(), userId: host.userId, role: "host" });

    const observerClient = connectClient(port, (await makeUserAndToken("disc-observer@example.com")).token);
    await new Promise<void>((resolve) => observerClient.once("connect", resolve));
    await new Promise<{ ok: boolean }>((resolve) => {
      observerClient.emit("room:join", { roomId: room._id.toString() }, resolve);
    });

    const hostClient = connectClient(port, host.token);
    await new Promise<void>((resolve) => hostClient.once("connect", resolve));
    await new Promise<{ ok: boolean }>((resolve) => {
      hostClient.emit("room:join", { roomId: room._id.toString() }, resolve);
    });

    const statusPromise = once(observerClient, "room:status");
    hostClient.close();
    const statusEvent = await statusPromise;

    expect(statusEvent.status).toBe("ended");
    observerClient.close();

    // observerClient.close() triggers its own disconnect -> leave() chain
    // asynchronously. Without waiting for it, the test (and the file's
    // afterEach/afterAll teardown) can proceed and tear down Mongo/Redis
    // while that chain is still in flight -- a real event-loop turn via a
    // fresh connect+ack round trip, not a timer, proves it has settled.
    const sentinel = connectClient(port, host.token);
    await new Promise<void>((resolve) => sentinel.once("connect", resolve));
    await new Promise<{ ok: boolean }>((resolve) => {
      sentinel.emit("room:join", { roomId: room._id.toString() }, () => resolve({ ok: true }));
    });
    sentinel.close();
  });
});
