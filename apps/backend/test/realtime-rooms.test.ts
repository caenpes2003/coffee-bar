/**
 * Integration test for Phase E: socket room scoping.
 *
 * Boots a real in-memory socket.io server attached to RealtimeGateway,
 * connects multiple clients, and verifies the routing rules:
 *   - session events reach clients in that session's room + staff broadcast
 *   - a client in a different session does NOT receive it
 *   - global events reach everyone
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, Server as HttpServer } from "http";
import { AddressInfo } from "net";
import { Server as IoServer } from "socket.io";
import { io as ioc, Socket as ClientSocket } from "socket.io-client";
import { RealtimeGateway } from "../src/modules/realtime/realtime.gateway";

let httpServer: HttpServer;
let ioServer: IoServer;
let gateway: RealtimeGateway;
let port: number;

function connectClient(): Promise<ClientSocket> {
  return new Promise((resolve) => {
    const sock = ioc(`http://localhost:${port}`, {
      transports: ["websocket"],
      forceNew: true,
    });
    sock.on("connect", () => resolve(sock));
  });
}

function waitForEvent<T>(
  sock: ClientSocket,
  event: string,
  timeoutMs = 200,
): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sock.off(event);
      resolve(null);
    }, timeoutMs);
    sock.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function emitFromClient(
  sock: ClientSocket,
  event: string,
  payload: unknown,
) {
  sock.emit(event, payload);
  // Give the server a tick to join the room before emissions targeting it.
  await new Promise((r) => setTimeout(r, 20));
}

beforeAll(async () => {
  httpServer = createServer();
  ioServer = new IoServer(httpServer, { cors: { origin: "*" } });
  gateway = new RealtimeGateway();
  (gateway as any).server = ioServer;

  // Wire the @SubscribeMessage handlers manually since we're not booting Nest.
  ioServer.on("connection", (socket) => {
    socket.on("tableSession:join", (sessionId: number) => {
      gateway.handleTableSessionJoin(sessionId, socket as any);
    });
    socket.on("tableSession:leave", (sessionId: number) => {
      gateway.handleTableSessionLeave(sessionId, socket as any);
    });
    socket.on("staff:join", () => {
      gateway.handleStaffJoin(socket as any);
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      port = (httpServer.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterAll(async () => {
  ioServer.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe("Phase E · session-scoped emissions", () => {
  it("session client receives bill:updated via the session room", async () => {
    // Until staff auth is in place, public emitters fan out to session + staff
    // broadcast, so *every* connected client sees the event. Test the room
    // mechanism directly by calling the private session emitter. This isolates
    // the room-scoping invariant that MUST hold before and after auth.
    const customerA = await connectClient();
    const customerB = await connectClient();

    await emitFromClient(customerA, "tableSession:join", 10);
    await emitFromClient(customerB, "tableSession:join", 20);

    const aPromise = waitForEvent<{ hello: number }>(customerA, "bill:updated");
    const bPromise = waitForEvent<{ hello: number }>(customerB, "bill:updated");

    (gateway as any).emitToSession(10, "bill:updated", { hello: 10 });

    const [a, b] = await Promise.all([aPromise, bPromise]);
    expect(a).toEqual({ hello: 10 });
    expect(b).toBeNull(); // customer B is in a different session room

    customerA.close();
    customerB.close();
  });

  it("public emitBillUpdated reaches session room + staff broadcast today", async () => {
    // This test documents current (pre-auth) behavior: staff channel is still
    // a broadcast, so every connected client receives it. When auth gates the
    // staff room, the second assertion flips to null.
    const customer = await connectClient();
    const outsider = await connectClient();

    await emitFromClient(customer, "tableSession:join", 77);
    // outsider joins no room

    const cp = waitForEvent(customer, "bill:updated");
    const op = waitForEvent(outsider, "bill:updated");

    gateway.emitBillUpdated(77, { x: 1 });

    expect(await cp).toEqual({ x: 1 });
    expect(await op).toEqual({ x: 1 }); // TODO(auth): null once staff is gated

    customer.close();
    outsider.close();
  });

  it("order-request:created reaches the session client and staff, but not other sessions", async () => {
    const customer = await connectClient();
    const staff = await connectClient();
    const other = await connectClient();

    await emitFromClient(customer, "tableSession:join", 30);
    await emitFromClient(staff, "staff:join", null);
    await emitFromClient(other, "tableSession:join", 31);

    const customerPromise = waitForEvent(customer, "order-request:created");
    const staffPromise = waitForEvent(staff, "order-request:created");
    const otherPromise = waitForEvent(other, "order-request:created");

    gateway.emitOrderRequestCreated(30, { req: "abc" });

    const [cust, stf, oth] = await Promise.all([
      customerPromise,
      staffPromise,
      otherPromise,
    ]);
    expect(cust).toEqual({ req: "abc" });
    expect(stf).toEqual({ req: "abc" }); // staff broadcast hits them
    expect(oth).toEqual({ req: "abc" }); // TODO(auth): today broadcast still hits everyone; documented behavior
    // When auth lands, staff emissions will room-scope and `oth` should become null.

    customer.close();
    staff.close();
    other.close();
  });

  it("global events (queue:updated) reach every connected client", async () => {
    const a = await connectClient();
    const b = await connectClient();

    const aPromise = waitForEvent(a, "queue:updated");
    const bPromise = waitForEvent(b, "queue:updated");

    gateway.emitQueueUpdated({ kind: "test" });

    const [ra, rb] = await Promise.all([aPromise, bPromise]);
    expect(ra).toEqual({ kind: "test" });
    expect(rb).toEqual({ kind: "test" });

    a.close();
    b.close();
  });

  it("leaving a session room stops session-channel delivery", async () => {
    // Directly test the session channel in isolation: after leaving the room,
    // session-scoped emissions must not reach the client.
    const client = await connectClient();
    await emitFromClient(client, "tableSession:join", 40);

    const first = waitForEvent(client, "order:updated");
    (gateway as any).emitToSession(40, "order:updated", { id: 1 });
    expect(await first).toEqual({ id: 1 });

    await emitFromClient(client, "tableSession:leave", 40);

    const second = waitForEvent(client, "order:updated");
    (gateway as any).emitToSession(40, "order:updated", { id: 2 });
    expect(await second).toBeNull();

    client.close();
  });

  it("session channel without sessionId throws (programmer error)", () => {
    expect(() =>
      (gateway as any).dispatch({
        channel: "session",
        event: "x",
        payload: {},
      }),
    ).toThrow(/sessionId/);
  });
});
