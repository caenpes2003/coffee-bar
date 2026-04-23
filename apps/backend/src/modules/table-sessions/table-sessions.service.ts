import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  OrderStatus,
  Prisma,
  TableSession,
  TableSessionStatus,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { TableProjectionService } from "../table-projection/table-projection.service";

type Tx = Prisma.TransactionClient;

const NON_CLOSED = [
  TableSessionStatus.open,
  TableSessionStatus.ordering,
  TableSessionStatus.closing,
];

const ACTIVE_ORDER_STATUSES = [
  OrderStatus.accepted,
  OrderStatus.preparing,
  OrderStatus.ready,
];

@Injectable()
export class TableSessionsService {
  private readonly logger = new Logger(TableSessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projection: TableProjectionService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async open(tableId: number): Promise<TableSession> {
    const table = await this.prisma.table.findUnique({ where: { id: tableId } });
    if (!table) {
      throw new NotFoundException(`Table ${tableId} not found`);
    }

    const session = await this.prisma.$transaction(async (tx) => {
      return this.tryOpenWithFailSafe(tableId, tx);
    });

    this.realtime.emitTableSessionOpened(session.id, this.serialize(session));
    this.realtime.emitTableUpdated({ id: tableId });
    return session;
  }

  private async tryOpenWithFailSafe(
    tableId: number,
    tx: Tx,
  ): Promise<TableSession> {
    try {
      return await this.createAndProject(tableId, tx);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        this.logger.warn(
          `Open session conflict on table ${tableId}; auto-closing stale session`,
        );
        await this.forceCloseActiveForTable(tableId, tx);
        return await this.createAndProject(tableId, tx);
      }
      throw e;
    }
  }

  private async createAndProject(
    tableId: number,
    tx: Tx,
  ): Promise<TableSession> {
    const session = await tx.tableSession.create({
      data: { table_id: tableId, status: TableSessionStatus.open },
    });
    await this.projection.onSessionOpened(tableId, session.id, tx);
    return session;
  }

  private async forceCloseActiveForTable(tableId: number, tx: Tx) {
    await tx.tableSession.updateMany({
      where: { table_id: tableId, status: { in: NON_CLOSED } },
      data: {
        status: TableSessionStatus.closed,
        closed_at: new Date(),
      },
    });
    await tx.table.update({
      where: { id: tableId },
      data: { current_session_id: null },
    });
  }

  async close(sessionId: number): Promise<TableSession> {
    const session = await this.prisma.tableSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException(`TableSession ${sessionId} not found`);
    }
    if (session.status === TableSessionStatus.closed) {
      return session;
    }

    const closed = await this.prisma.$transaction(async (tx) => {
      const activeOrders = await tx.order.count({
        where: {
          table_session: {
            table_id: session.table_id,
          },
          status: { in: ACTIVE_ORDER_STATUSES },
        },
      });

      if (activeOrders > 0) {
        throw new BadRequestException({
          message: "Cannot close session while there are active orders",
          code: "TABLE_SESSION_HAS_ACTIVE_ORDERS",
          active_orders: activeOrders,
        });
      }

      const updated = await tx.tableSession.update({
        where: { id: sessionId },
        data: {
          status: TableSessionStatus.closed,
          closed_at: new Date(),
        },
      });
      await this.projection.onSessionClosed(session.table_id, tx);
      return updated;
    });

    this.realtime.emitTableSessionClosed(closed.id, this.serialize(closed));
    this.realtime.emitTableUpdated({ id: session.table_id });
    return closed;
  }

  async getCurrentForTable(tableId: number): Promise<TableSession | null> {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
      select: { id: true, current_session_id: true },
    });
    if (!table) {
      throw new NotFoundException(`Table ${tableId} not found`);
    }
    if (!table.current_session_id) return null;
    return this.prisma.tableSession.findUnique({
      where: { id: table.current_session_id },
    });
  }

  async getById(sessionId: number): Promise<TableSession> {
    const session = await this.prisma.tableSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException(`TableSession ${sessionId} not found`);
    }
    return session;
  }

  async requireOpenForTable(tableId: number): Promise<TableSession> {
    const session = await this.getCurrentForTable(tableId);
    if (!session || session.status === TableSessionStatus.closed) {
      throw new BadRequestException({
        message: `Table ${tableId} has no open session`,
        code: "TABLE_SESSION_NOT_OPEN",
      });
    }
    return session;
  }

  serialize(session: TableSession) {
    return {
      ...session,
      total_consumption: Number(session.total_consumption),
    };
  }
}
