import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { Server, Socket } from "socket.io";

type Channel = "global" | "staff" | "session";

type EventPayload = {
  channel: Channel;
  event: string;
  payload: unknown;
  sessionId?: number;
};

const STAFF_ROOM = "staff";
const sessionRoom = (sessionId: number) => `tableSession:${sessionId}`;
const tableRoom = (tableId: number) => `table:${tableId}`;

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // ─── Room subscriptions ───────────────────────────────────────────────────

  @SubscribeMessage("tableSession:join")
  handleTableSessionJoin(
    @MessageBody() sessionId: number,
    @ConnectedSocket() client: Socket,
  ) {
    const room = sessionRoom(sessionId);
    void client.join(room);
    this.logger.log(`Client ${client.id} joined ${room}`);
  }

  @SubscribeMessage("tableSession:leave")
  handleTableSessionLeave(
    @MessageBody() sessionId: number,
    @ConnectedSocket() client: Socket,
  ) {
    const room = sessionRoom(sessionId);
    void client.leave(room);
  }

  @SubscribeMessage("staff:join")
  handleStaffJoin(@ConnectedSocket() client: Socket) {
    void client.join(STAFF_ROOM);
    this.logger.log(`Client ${client.id} joined ${STAFF_ROOM}`);
  }

  @SubscribeMessage("table:join")
  handleTableJoin(
    @MessageBody() tableId: number,
    @ConnectedSocket() client: Socket,
  ) {
    // Legacy room kept for compatibility with older clients.
    const room = tableRoom(tableId);
    void client.join(room);
  }

  // ─── Channel layer ────────────────────────────────────────────────────────
  //
  // Why: Emitting is encapsulated in three channels so future auth/role wiring
  // (e.g. staff-only auth) can swap a single method without touching callers.
  //
  // global  -> every connected client (queue, playback, lobby views).
  // staff   -> staff dashboard. Today broadcast via `server.emit`; later becomes
  //            `server.to(STAFF_ROOM).emit` once auth gates the join.
  // session -> the specific tableSession room only.

  private dispatch(evt: EventPayload) {
    const { channel, event, payload, sessionId } = evt;
    switch (channel) {
      case "global":
        this.server.emit(event, payload);
        return;
      case "staff":
        // TODO(auth): swap to `this.server.to(STAFF_ROOM).emit(event, payload)`
        // once staff socket auth is in place. For now, broadcast to match
        // current behavior. The channel boundary is the important part.
        this.server.emit(event, payload);
        return;
      case "session":
        if (sessionId == null) {
          throw new Error(`session channel requires sessionId (event=${event})`);
        }
        this.server.to(sessionRoom(sessionId)).emit(event, payload);
        return;
    }
  }

  private emitToSession(sessionId: number, event: string, payload: unknown) {
    this.dispatch({ channel: "session", event, payload, sessionId });
  }

  private emitToStaff(event: string, payload: unknown) {
    this.dispatch({ channel: "staff", event, payload });
  }

  private emitGlobal(event: string, payload: unknown) {
    this.dispatch({ channel: "global", event, payload });
  }

  // ─── Public emitters ──────────────────────────────────────────────────────
  // Each emitter declares which channels it fans out to. Session-scoped events
  // take sessionId and fan out to (session + staff). Global events go to every
  // client. Call sites remain simple and readable.

  emitBillUpdated(sessionId: number, payload: unknown) {
    this.emitToSession(sessionId, "bill:updated", payload);
    this.emitToStaff("bill:updated", payload);
  }

  emitOrderCreated(sessionId: number, payload: unknown) {
    this.emitToSession(sessionId, "order:created", payload);
    this.emitToStaff("order:created", payload);
  }

  emitOrderUpdated(sessionId: number, payload: unknown) {
    this.emitToSession(sessionId, "order:updated", payload);
    this.emitToStaff("order:updated", payload);
  }

  emitOrderRequestCreated(sessionId: number, payload: unknown) {
    this.emitToSession(sessionId, "order-request:created", payload);
    this.emitToStaff("order-request:created", payload);
  }

  emitOrderRequestUpdated(sessionId: number, payload: unknown) {
    this.emitToSession(sessionId, "order-request:updated", payload);
    this.emitToStaff("order-request:updated", payload);
  }

  emitTableSessionOpened(sessionId: number, payload: unknown) {
    this.emitToSession(sessionId, "table-session:opened", payload);
    this.emitToStaff("table-session:opened", payload);
  }

  emitTableSessionUpdated(sessionId: number, payload: unknown) {
    this.emitToSession(sessionId, "table-session:updated", payload);
    this.emitToStaff("table-session:updated", payload);
  }

  emitTableSessionClosed(sessionId: number, payload: unknown) {
    this.emitToSession(sessionId, "table-session:closed", payload);
    this.emitToStaff("table-session:closed", payload);
  }

  // Table-level events target staff + global admin views. Customers consume
  // session/bill signals, not raw Table rows.
  emitTableUpdated(payload: unknown) {
    this.emitToStaff("table:updated", payload);
    this.emitGlobal("table:updated", payload);
  }

  // Music surface is global by design: player page serves every client.
  emitQueueUpdated(payload: unknown) {
    this.emitGlobal("queue:updated", payload);
  }

  emitPlaybackUpdated(payload: unknown) {
    this.emitGlobal("playback:updated", payload);
  }
}
