import http from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createApp } from "../../src/app";
import { attachSocketServer } from "../../src/realtime/io";
import { withTestDatabases } from "../helpers/db";
import { UserModel } from "../../src/models/user.model";
import { RoomModel } from "../../src/models/room.model";
import { signAccessToken } from "../../src/modules/auth/auth.service";
import type { ClientToServerEvents, ServerToClientEvents } from "../../src/realtime/events";

type Client = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

async function makeUserAndToken(email: string) {
  const user = await UserModel.create({ name: "Iso User", email, passwordHash: "h" });
  return { userId: user._id.toString(), token: signAccessToken(user._id.toString()) };
}

function connectAndJoin(port: number, token: string, roomId: string): Promise<Client> {
  return new Promise((resolve) => {
    const client: Client = ioClient(`http://localhost:${port}`, { auth: { token }, forceNew: true });
    client.once("connect", () => {
      client.emit("room:join", { roomId }, () => resolve(client));
    });
  });
}

describe("Socket.IO room isolation", () => {
  withTestDatabases();
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    server = http.createServer(createApp());
    attachSocketServer(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("a room:message sent in room A reaches only room A's members, never room B's", async () => {
    const user1 = await makeUserAndToken("user1@example.com");
    const user2 = await makeUserAndToken("user2@example.com");
    const user3 = await makeUserAndToken("user3@example.com");
    const user4 = await makeUserAndToken("user4@example.com");

    const roomA = await RoomModel.create({ name: "Room A", host: user1.userId });
    const roomB = await RoomModel.create({ name: "Room B", host: user3.userId });

    const client1 = await connectAndJoin(port, user1.token, roomA._id.toString());
    const client2 = await connectAndJoin(port, user2.token, roomA._id.toString());
    const client3 = await connectAndJoin(port, user3.token, roomB._id.toString());
    const client4 = await connectAndJoin(port, user4.token, roomB._id.toString());

    const receivedByClient2 = new Promise<{ roomId: string; text: string }>((resolve) => {
      client2.once("room:message", resolve);
    });

    let client3Received = false;
    let client4Received = false;
    client3.once("room:message", () => { client3Received = true; });
    client4.once("room:message", () => { client4Received = true; });

    client1.emit("room:message", { roomId: roomA._id.toString(), text: "hello room A" });

    const messageAtClient2 = await receivedByClient2;
    expect(messageAtClient2.text).toBe("hello room A");
    expect(messageAtClient2.roomId).toBe(roomA._id.toString());

    // A second real round trip through the server (a join ack on room B)
    // proves the event loop has had a full turn to deliver any (incorrect)
    // cross-room broadcast, without resorting to a timer.
    await new Promise<{ ok: boolean }>((resolve) => {
      client3.emit("room:join", { roomId: roomB._id.toString() }, resolve);
    });

    expect(client3Received).toBe(false);
    expect(client4Received).toBe(false);

    client1.close();
    client2.close();
    client3.close();
    client4.close();

    // Closing the four clients triggers four concurrent disconnect -> leave()
    // chains (each touches Mongo). Without waiting for them, this file's own
    // afterEach/afterAll can close the DB connections while those chains are
    // still in flight, producing benign but noisy "connection is closed"
    // errors in the log. One more real round trip (not a timer) gives the
    // event loop the turns it needs to drain them first.
    const sentinel = await connectAndJoin(port, user1.token, roomA._id.toString());
    sentinel.close();
  });
});
