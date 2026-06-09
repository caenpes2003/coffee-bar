import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from "@nestjs/common";
import {
  CashRegisterStatus,
  Payment,
  PaymentKind,
  PaymentMethod,
  PaymentReverseReason,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { OutboxEventService } from "../outbox/outbox-event.service";
import {
  serializePaymentForOutbox,
  serializePaymentReversalForOutbox,
} from "./outbox-payload";

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
   * Reversar un Payment previo. Append-only: crea una fila nueva
   * con `kind=reversal` y `amount` con signo opuesto al original,
   * dejando el Payment original intacto para audit.
   *
   * Reglas:
   *   - El Payment original NO puede ser un reversal (no se reversan
   *     reversos).
   *   - Solo se permite UN reverso por Payment (unique index sobre
   *     reverses_id a nivel BD; también validamos acá con mensaje).
   *   - reason='other' requiere reason_detail no vacío.
   *   - El reverso se atribuye a la sesión de caja ABIERTA actual
   *     (no a la del Payment original): así el descuento aparece en
   *     el día contable donde efectivamente sale la plata de la caja.
   *     Si el día está cerrado, falla con 412 — el operador debe
   *     abrir el día primero (igual que cualquier mutación de caja).
   *   - El método del reverso copia el del original (no se permite
   *     "reversar tarjeta como efectivo"). Si se necesita re-cobrar
   *     con otro método, es un nuevo cobro aparte.
   *
   * Devuelve la fila de reverso creada.
   */
  async reverse(
    paymentId: number,
    input: {
      reason: PaymentReverseReason;
      reason_detail?: string;
      actor: Actor;
    },
  ): Promise<Payment> {
    if (
      input.reason === PaymentReverseReason.other &&
      (!input.reason_detail || input.reason_detail.trim().length < 3)
    ) {
      throw new BadRequestException({
        message: "reason='other' requires reason_detail (min 3 chars)",
        code: "PAYMENT_REVERSE_DETAIL_REQUIRED",
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const original = await tx.payment.findUnique({
        where: { id: paymentId },
      });
      if (!original) {
        throw new NotFoundException({
          message: `Payment ${paymentId} not found`,
          code: "PAYMENT_NOT_FOUND",
        });
      }
      if (original.kind === PaymentKind.reversal) {
        throw new BadRequestException({
          message: "Cannot reverse a reversal",
          code: "PAYMENT_REVERSE_OF_REVERSAL",
        });
      }

      // Defensa en profundidad: el UNIQUE index sobre reverses_id ya
      // bloquearía un segundo reverso, pero queremos un mensaje claro.
      const existing = await tx.payment.findUnique({
        where: { reverses_id: paymentId },
      });
      if (existing) {
        throw new ConflictException({
          message: `Payment ${paymentId} already reversed by ${existing.id}`,
          code: "PAYMENT_ALREADY_REVERSED",
          existing_reversal_id: existing.id,
        });
      }

      // El reverso se atribuye al día contable ABIERTO ahora (no al
      // del Payment original). Si la caja está cerrada, falla — el
      // operador debe abrir día primero, igual que para cobrar.
      const cashSession = await tx.cashRegisterSession.findFirst({
        where: { status: CashRegisterStatus.open },
      });
      if (!cashSession) {
        throw new PreconditionFailedException({
          message:
            "Cash register is closed. Open the day before reversing payments.",
          code: "CASH_REGISTER_CLOSED",
        });
      }

      // amount opuesto. Decimal preserva precisión: usamos .neg().
      const negativeAmount = new Prisma.Decimal(original.amount).neg();

      const reversal = await tx.payment.create({
        data: {
          table_session_id: original.table_session_id,
          cash_register_session_id: cashSession.id,
          method: original.method,
          kind: PaymentKind.reversal,
          amount: negativeAmount,
          // Reverso NUNCA enlaza Consumption: el refund de Consumption
          // es un flujo independiente. Si el operador quiere también
          // devolver el producto al stock, hace refund por separado
          // desde /admin/sales. Mantener ambos flujos desacoplados
          // permite reversar un cobro sin tocar inventario (ej. Bold
          // rechazó la tarjeta — la mesa SÍ se tomó lo que consumió).
          consumption_id: null,
          reverses_id: original.id,
          reverse_reason: input.reason,
          reverse_reason_detail: input.reason_detail?.trim() || null,
          created_by: input.actor?.name ?? null,
        },
      });

      await this.outbox.enqueue(tx, {
        event_type: "payment.reversed",
        aggregate_type: "Payment",
        aggregate_id: reversal.external_id,
        payload: serializePaymentReversalForOutbox(
          reversal,
          original.external_id,
        ),
      });

      return reversal;
    });
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
