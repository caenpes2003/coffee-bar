import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from "@nestjs/common";
import {
  CashRegisterSession,
  CashRegisterStatus,
  PaymentMethod,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { OutboxEventService } from "../outbox/outbox-event.service";
import { CloseCashRegisterDto } from "./dto/close-cash-register.dto";
import { OpenCashRegisterDto } from "./dto/open-cash-register.dto";
import { serializeCashRegisterForOutbox } from "./outbox-payload";

type Tx = Prisma.TransactionClient;

export type Actor = { user_id: number; name: string } | null;

/**
 * CashRegisterService — Fase A+ del roadmap.
 *
 * Maneja el ciclo de vida del "día contable" del bar:
 *   open → operación → close → (nueva apertura → operación → close → ...)
 *
 * Solo puede existir UNA sesión con status=open simultáneamente; lo
 * enforce un partial unique index en BD. Cualquier intento de abrir
 * dos a la vez falla con ConflictException.
 *
 * `requireOpen()` es el método clave que invocan otros services antes
 * de mutaciones operativas (cobros, pedidos, ingresos). Si no hay día
 * abierto → 412 CASH_REGISTER_CLOSED.
 *
 * Ver MIGRACION_SYNC.md "Fase A+" para racional completo y
 * ARQUITECTURA.md §2 (dominio Payment / CashMovement).
 */
@Injectable()
export class CashRegisterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxEventService,
  ) {}

  /**
   * Devuelve la sesión activa o null. Útil para checks no bloqueantes
   * (ej: banner del admin "no hay día abierto, abrí uno").
   */
  async getCurrentOpen(tx?: Tx): Promise<CashRegisterSession | null> {
    const client = tx ?? this.prisma;
    return client.cashRegisterSession.findFirst({
      where: { status: CashRegisterStatus.open },
    });
  }

  /**
   * Verificación bloqueante: devuelve la sesión activa o throw 412.
   * Llamada por todos los endpoints operativos antes de mutar estado.
   *
   * NO crea sesión automáticamente — si no hay, es error operativo
   * (el admin debe abrir el día explícitamente). El auto-día del
   * deploy es la única excepción documentada (ver migration).
   *
   * Acepta tx opcional para correr dentro de una transacción del
   * caller (evita race entre check y mutación).
   */
  async requireOpen(tx?: Tx): Promise<CashRegisterSession> {
    const session = await this.getCurrentOpen(tx);
    if (!session) {
      throw new PreconditionFailedException({
        message:
          "Cash register is closed. Open the day before operating.",
        code: "CASH_REGISTER_CLOSED",
      });
    }
    return session;
  }

  /**
   * Abrir un nuevo día. Falla con 409 CASH_REGISTER_ALREADY_OPEN si
   * ya existe una sesión activa (el partial unique index también lo
   * bloquearía a nivel BD, pero hacemos el check explícito para dar
   * mensaje claro).
   *
   * Bypass: si dto.bypass=true, opening_balance puede ser 0 pero
   * bypass_reason es obligatorio. Diseñado como red de seguridad si
   * el flujo normal de apertura falla por algún bug — permite operar
   * con marca explícita en el día.
   */
  async open(
    dto: OpenCashRegisterDto,
    actor: Actor,
  ): Promise<CashRegisterSession> {
    if (dto.bypass) {
      if (!dto.bypass_reason || dto.bypass_reason.trim().length < 3) {
        throw new BadRequestException({
          message: "bypass requires bypass_reason (min 3 chars)",
          code: "CASH_REGISTER_BYPASS_REASON_REQUIRED",
        });
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.cashRegisterSession.findFirst({
        where: { status: CashRegisterStatus.open },
      });
      if (existing) {
        throw new ConflictException({
          message:
            "There is already an open cash register session. Close it before opening a new one.",
          code: "CASH_REGISTER_ALREADY_OPEN",
          open_session_id: existing.id,
        });
      }

      const created = await tx.cashRegisterSession.create({
        data: {
          status: CashRegisterStatus.open,
          opening_balance: new Prisma.Decimal(dto.opening_balance),
          opened_by: actor?.name ?? null,
          opened_via_bypass: dto.bypass === true,
          opened_bypass_reason: dto.bypass
            ? dto.bypass_reason!.trim()
            : null,
          notes: dto.notes?.trim() || null,
        },
      });

      // Enqueue dentro de la MISMA transacción. Si el enqueue falla
      // (registry/payload), la sesión NO se crea — invariante outbox.
      await this.outbox.enqueue(tx, {
        event_type: "cash_register.opened",
        aggregate_type: "CashRegisterSession",
        aggregate_id: created.external_id,
        payload: serializeCashRegisterForOutbox(created),
      });

      return created;
    });

    return result;
  }

  /**
   * Cerrar el día activo. Calcula `closing_balance_expected` desde
   * el ledger:
   *
   *   expected = opening_balance + Σ Payment(method=efectivo).amount
   *
   * Para futura extensión: si llegan a existir CashMovement (retiros,
   * depósitos intra-día), sumarlos también. Hoy no existen.
   *
   * Persiste `closing_balance_declared`, `expected` y `difference`
   * para auditoría histórica. Marca status=closed; el partial unique
   * index libera el slot y se puede abrir un día nuevo.
   */
  async close(
    dto: CloseCashRegisterDto,
    actor: Actor,
  ): Promise<CashRegisterSession> {
    const result = await this.prisma.$transaction(async (tx) => {
      const open = await tx.cashRegisterSession.findFirst({
        where: { status: CashRegisterStatus.open },
      });
      if (!open) {
        throw new NotFoundException({
          message: "No cash register session is open",
          code: "CASH_REGISTER_NOT_OPEN",
        });
      }

      // Calcular expected: opening_balance + cobros en efectivo del día.
      const cashPayments = await tx.payment.aggregate({
        where: {
          cash_register_session_id: open.id,
          method: PaymentMethod.efectivo,
        },
        _sum: { amount: true },
      });
      const cashIn = cashPayments._sum.amount ?? new Prisma.Decimal(0);
      const expected = new Prisma.Decimal(open.opening_balance).add(cashIn);
      const declared = new Prisma.Decimal(dto.closing_balance_declared);
      const difference = declared.sub(expected);

      const closed = await tx.cashRegisterSession.update({
        where: { id: open.id },
        data: {
          status: CashRegisterStatus.closed,
          closed_at: new Date(),
          closed_by: actor?.name ?? null,
          closing_balance_declared: declared,
          closing_balance_expected: expected,
          difference,
          notes: dto.notes?.trim()
            ? `${open.notes ? `${open.notes}\n---\n` : ""}${dto.notes.trim()}`
            : open.notes,
        },
      });

      await this.outbox.enqueue(tx, {
        event_type: "cash_register.closed",
        aggregate_type: "CashRegisterSession",
        aggregate_id: closed.external_id,
        payload: serializeCashRegisterForOutbox(closed),
      });

      return closed;
    });

    return result;
  }

  /**
   * Listar sesiones de caja, con filtro opcional por status. Usado
   * por el tab Caja del admin para mostrar histórico de cierres.
   */
  async listSessions(opts: {
    status?: CashRegisterStatus;
    limit?: number;
  }): Promise<CashRegisterSession[]> {
    return this.prisma.cashRegisterSession.findMany({
      where: opts.status ? { status: opts.status } : undefined,
      orderBy: { opened_at: "desc" },
      take: opts.limit && opts.limit > 0 ? opts.limit : 50,
    });
  }

  /**
   * Snapshot detallado de una sesión: totales por método, cantidad de
   * pagos, refunds, extras, luggage. Usado para el "ticket de cierre"
   * que ve el admin al cerrar el día y para el histórico.
   */
  async getSessionDetail(sessionId: number): Promise<{
    session: CashRegisterSession;
    totals_by_method: Record<PaymentMethod, { count: number; amount: number }>;
    payments_count: number;
    extra_income_total: number;
    luggage_total: number;
  }> {
    const session = await this.prisma.cashRegisterSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException({
        message: `CashRegisterSession ${sessionId} not found`,
        code: "CASH_REGISTER_NOT_FOUND",
      });
    }

    const payments = await this.prisma.payment.groupBy({
      by: ["method"],
      where: { cash_register_session_id: sessionId },
      _count: { _all: true },
      _sum: { amount: true },
    });
    const totals_by_method: Record<
      PaymentMethod,
      { count: number; amount: number }
    > = {
      [PaymentMethod.efectivo]: { count: 0, amount: 0 },
      [PaymentMethod.tarjeta_bold]: { count: 0, amount: 0 },
      [PaymentMethod.qr_bold]: { count: 0, amount: 0 },
    };
    for (const p of payments) {
      totals_by_method[p.method] = {
        count: p._count._all,
        amount: Number(p._sum.amount ?? 0),
      };
    }

    const paymentsCount = await this.prisma.payment.count({
      where: { cash_register_session_id: sessionId },
    });

    // Extras (ingresos baño / manual / etc) atribuidos a esta sesión.
    const extras = await this.prisma.extraIncome.aggregate({
      where: {
        cash_register_session_id: sessionId,
        status: "active",
      },
      _sum: { total_amount: true },
    });

    // Luggage (cobros de guardarropa) atribuidos a esta sesión.
    const luggage = await this.prisma.luggageTicket.aggregate({
      where: {
        cash_register_session_id: sessionId,
        payment_status: "paid",
      },
      _sum: { amount: true },
    });

    return {
      session,
      totals_by_method,
      payments_count: paymentsCount,
      extra_income_total: Number(extras._sum.total_amount ?? 0),
      luggage_total: Number(luggage._sum.amount ?? 0),
    };
  }
}
