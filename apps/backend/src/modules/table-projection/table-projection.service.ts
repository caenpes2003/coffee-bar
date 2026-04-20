import { Injectable } from "@nestjs/common";
import { Prisma, TableStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";

type Tx = Prisma.TransactionClient;

type Client = PrismaService | Tx;

/**
 * Sole writer for the Table read model.
 *
 * Why: Table is the operational projection (status, counters, consumption cache)
 * that fairness + UI read. Scattered writes caused drift — this service enforces
 * R1 (no external writes) and R2 (only the listed triggers mutate these fields).
 *
 * How to apply: any code that used to touch `Table.total_consumption`,
 * `active_order_count`, `pending_request_count`, `status`, `current_session_id`
 * or `last_activity_at` must call through here instead.
 */
@Injectable()
export class TableProjectionService {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: Tx): Client {
    return tx ?? this.prisma;
  }

  async onSessionOpened(tableId: number, sessionId: number, tx?: Tx) {
    await this.client(tx).table.update({
      where: { id: tableId },
      data: {
        current_session_id: sessionId,
        status: TableStatus.occupied,
        last_activity_at: new Date(),
      },
    });
  }

  async onSessionClosed(tableId: number, tx?: Tx) {
    await this.client(tx).table.update({
      where: { id: tableId },
      data: {
        current_session_id: null,
        status: TableStatus.available,
        total_consumption: 0,
        active_order_count: 0,
        pending_request_count: 0,
        last_activity_at: new Date(),
      },
    });
  }

  async onOrderRequestCreated(tableId: number, tx?: Tx) {
    await this.client(tx).table.update({
      where: { id: tableId },
      data: {
        pending_request_count: { increment: 1 },
        last_activity_at: new Date(),
      },
    });
  }

  async onOrderRequestAccepted(tableId: number, tx?: Tx) {
    await this.client(tx).table.update({
      where: { id: tableId },
      data: {
        pending_request_count: { decrement: 1 },
        active_order_count: { increment: 1 },
        last_activity_at: new Date(),
      },
    });
  }

  async onOrderRequestRejected(tableId: number, tx?: Tx) {
    await this.client(tx).table.update({
      where: { id: tableId },
      data: {
        pending_request_count: { decrement: 1 },
        last_activity_at: new Date(),
      },
    });
  }

  async onOrderLeftActive(tableId: number, tx?: Tx) {
    await this.client(tx).table.update({
      where: { id: tableId },
      data: {
        active_order_count: { decrement: 1 },
        last_activity_at: new Date(),
      },
    });
  }

  async onConsumptionCreated(
    tableId: number,
    amount: Prisma.Decimal | number,
    tx?: Tx,
  ) {
    await this.client(tx).table.update({
      where: { id: tableId },
      data: {
        total_consumption: { increment: amount },
        last_activity_at: new Date(),
      },
    });
  }

  async onConsumptionReversed(
    tableId: number,
    amount: Prisma.Decimal | number,
    tx?: Tx,
  ) {
    await this.client(tx).table.update({
      where: { id: tableId },
      data: {
        total_consumption: { decrement: amount },
        last_activity_at: new Date(),
      },
    });
  }
}
