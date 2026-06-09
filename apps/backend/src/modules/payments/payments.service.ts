import { Injectable } from "@nestjs/common";
import {
  Payment,
  PaymentKind,
  PaymentMethod,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { OutboxEventService } from "../outbox/outbox-event.service";
import { serializePaymentForOutbox } from "./outbox-payload";

type Tx = Prisma.TransactionClient;

export type Actor = { user_id: number; name: string } | null;

/**
 * PaymentsService — Fase A+.
 *
 * Crea filas en la tabla `Payment` con su método y kind, dentro de la
 * transacción del caller. Emite `payment.created` al outbox por cada
 * fila creada.
 *
 * NO maneja la lógica de Consumption ni de cierre de TableSession:
 *   - El caller (ConsumptionsService.recordPartialPayment) crea el
 *     Consumption(type=partial_payment) y después invoca
 *     `recordPartial()` para anexar el Payment.
 *   - El caller (TableSessionsService.markPaid) setea paid_at y
 *     después invoca `recordFinal()` para anexar N Payments.
 *
 * Esta separación mantiene cada service con responsabilidad clara:
 * PaymentsService solo se preocupa por persistir métodos de pago,
 * no por el ledger ni por el ciclo de vida de la sesión.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxEventService,
  ) {}

  /**
   * Registrar un pago parcial dentro de la transacción del caller.
   *
   * Asume que ya existe un Consumption(type=partial_payment) creado
   * justo antes en la misma tx, y se enlaza vía `consumption_id`.
   */
  async recordPartial(
    tx: Tx,
    input: {
      table_session_id: number;
      cash_register_session_id: number;
      method: PaymentMethod;
      amount: number;
      consumption_id: number;
      actor: Actor;
      notes?: string;
      reference?: string;
    },
  ): Promise<Payment> {
    const created = await tx.payment.create({
      data: {
        table_session_id: input.table_session_id,
        cash_register_session_id: input.cash_register_session_id,
        method: input.method,
        kind: PaymentKind.partial,
        amount: new Prisma.Decimal(input.amount),
        consumption_id: input.consumption_id,
        reference: input.reference?.trim() || null,
        notes: input.notes?.trim() || null,
        created_by: input.actor?.name ?? null,
      },
    });
    await this.outbox.enqueue(tx, {
      event_type: "payment.created",
      aggregate_type: "Payment",
      aggregate_id: created.external_id,
      payload: serializePaymentForOutbox(created),
    });
    return created;
  }

  /**
   * Registrar UNO o VARIOS pagos finales al cerrar la cuenta. Los
   * cobros divididos ($30k tarjeta + $20k efectivo) generan N filas
   * Payment con kind=final.
   *
   * NO valida que sum(amounts) === total pendiente — eso es
   * responsabilidad del caller (TableSessionsService.markPaid).
   *
   * Devuelve la lista de Payment creados, en el mismo orden del input.
   */
  async recordFinal(
    tx: Tx,
    input: {
      table_session_id: number;
      cash_register_session_id: number;
      payments: Array<{
        method: PaymentMethod;
        amount: number;
        reference?: string;
        notes?: string;
      }>;
      actor: Actor;
    },
  ): Promise<Payment[]> {
    const created: Payment[] = [];
    for (const p of input.payments) {
      const row = await tx.payment.create({
        data: {
          table_session_id: input.table_session_id,
          cash_register_session_id: input.cash_register_session_id,
          method: p.method,
          kind: PaymentKind.final,
          amount: new Prisma.Decimal(p.amount),
          consumption_id: null,
          reference: p.reference?.trim() || null,
          notes: p.notes?.trim() || null,
          created_by: input.actor?.name ?? null,
        },
      });
      await this.outbox.enqueue(tx, {
        event_type: "payment.created",
        aggregate_type: "Payment",
        aggregate_id: row.external_id,
        payload: serializePaymentForOutbox(row),
      });
      created.push(row);
    }
    return created;
  }

  /**
   * Listar los pagos de una sesión (parciales + finales). Usado por
   * el ticket térmico del tab Detalle para mostrar el desglose por
   * método de pago.
   */
  async listForSession(table_session_id: number): Promise<Payment[]> {
    return this.prisma.payment.findMany({
      where: { table_session_id },
      orderBy: { created_at: "asc" },
    });
  }
}
