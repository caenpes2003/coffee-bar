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
  ExpenseCategory,
  ExpenseKind,
  LuggagePaymentStatus,
  PaymentMethod,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { serializeExpenseForOutbox } from "../expenses/outbox-payload";
import { ExpensesService } from "../expenses/expenses.service";
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
    private readonly expenses: ExpensesService,
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

      // Calcular expected:
      //   opening_balance
      //   + cobros en efectivo del día (Payment)
      //   + ingresos extra EN EFECTIVO del día (baños, manuales)
      //   + guardarropa pagado EN EFECTIVO del día
      //   - gastos pagados en efectivo del día (netos: expense - reversal)
      //
      // ExtraIncome y LuggageTicket trackean método: solo lo cobrado
      // en efectivo entra a la caja física esperada; lo cobrado por
      // Bold se reporta en el neto Bold del día.
      //
      // Los gastos pagados con tarjeta/QR Bold NO afectan la caja
      // física esperada — ese dinero nunca estuvo en caja, salió de
      // la cuenta Bold directamente. Por eso aquí solo restamos los
      // efectivo. El neto Bold del día se reporta aparte en el ticket.
      const cashPayments = await tx.payment.aggregate({
        where: {
          cash_register_session_id: open.id,
          method: PaymentMethod.efectivo,
        },
        _sum: { amount: true },
      });
      const cashIn = cashPayments._sum.amount ?? new Prisma.Decimal(0);

      // Ingresos extra activos (no reversados) de esta sesión — SOLO
      // los cobrados en efectivo entran a la caja física. Los pagados
      // por Bold van al neto Bold, no al esperado en caja.
      const extraIncome = await tx.extraIncome.aggregate({
        where: {
          cash_register_session_id: open.id,
          status: "active",
          method: PaymentMethod.efectivo,
        },
        _sum: { total_amount: true },
      });
      const extraIn = extraIncome._sum.total_amount ?? new Prisma.Decimal(0);

      // Guardarropa pagado en efectivo de esta sesión. Antes NO se
      // sumaba al expected (el comentario lo prometía pero el aggregate
      // no existía) — el banner del frontend sí lo sumaba, así que un
      // día con maletas descuadraba contra la vista previa. Igual que
      // los extras, solo el efectivo entra a la caja física.
      const luggageIncome = await tx.luggageTicket.aggregate({
        where: {
          cash_register_session_id: open.id,
          payment_status: LuggagePaymentStatus.paid,
          method: PaymentMethod.efectivo,
        },
        _sum: { amount: true },
      });
      const luggageIn =
        luggageIncome._sum.amount ?? new Prisma.Decimal(0);

      const cashExpenses = await tx.expense.aggregate({
        where: {
          cash_register_session_id: open.id,
          method: PaymentMethod.efectivo,
        },
        _sum: { amount: true },
      });
      // amount viene positivo en kind=expense y negativo en kind=reversal,
      // entonces la SUM ya viene neta. Restar la suma neta del expected.
      const cashOut = cashExpenses._sum.amount ?? new Prisma.Decimal(0);

      const expected = new Prisma.Decimal(open.opening_balance)
        .add(cashIn)
        .add(extraIn)
        .add(luggageIn)
        .sub(cashOut);
      const declared = new Prisma.Decimal(dto.closing_balance_declared);
      const difference = declared.sub(expected);

      // "Manejar excepción": nota en la jornada para que quede rastro
      // legible de que el descuadre se conciliió contra el saldo.
      const handleDiscrepancy =
        dto.handle_discrepancy === true && !difference.isZero();
      const exceptionNote = handleDiscrepancy
        ? `Excepción manejada: descuadre de ${difference.toString()} registrado como ${difference.isNegative() ? "gasto" : "ingreso extra"} de conciliación.`
        : null;

      const closed = await tx.cashRegisterSession.update({
        where: { id: open.id },
        data: {
          status: CashRegisterStatus.closed,
          closed_at: new Date(),
          closed_by: actor?.name ?? null,
          closing_balance_declared: declared,
          closing_balance_expected: expected,
          difference,
          notes: [open.notes, dto.notes?.trim(), exceptionNote]
            .filter((s): s is string => Boolean(s && s.length))
            .join("\n---\n") || null,
        },
      });

      // Ajuste de conciliación DESPUÉS de persistir expected/difference:
      // la jornada registra su descuadre intacto (auditoría histórica);
      // el gasto/ingreso solo corrige el SALDO del bar para que refleje
      // la plata que físicamente hay.
      if (handleDiscrepancy) {
        if (difference.isNegative()) {
          // Faltante: salió plata que el ledger no explica → gasto.
          const missing = difference.neg();
          const expense = await tx.expense.create({
            data: {
              cash_register_session_id: closed.id,
              method: PaymentMethod.efectivo,
              category: ExpenseCategory.otros,
              kind: ExpenseKind.expense,
              amount: missing,
              concept: `Descuadre de cierre — faltante`,
              notes: `Conciliación automática al cerrar. Esperado ${expected.toString()}, declarado ${declared.toString()}.`,
              created_by: actor?.name ?? null,
            },
          });
          await this.outbox.enqueue(tx, {
            event_type: "expense.created",
            aggregate_type: "Expense",
            aggregate_id: expense.external_id,
            payload: serializeExpenseForOutbox(expense),
          });
        } else {
          // Sobrante: entró plata que el ledger no explica → ingreso
          // extra manual. (ExtraIncome aún no emite outbox — igual que
          // los demás ingresos extra, pendiente de MVP 2.)
          await tx.extraIncome.create({
            data: {
              type: "manual",
              // El sobrante es plata FÍSICA contada en la caja.
              method: PaymentMethod.efectivo,
              amount: difference,
              quantity: 1,
              total_amount: difference,
              status: "active",
              concept: "Descuadre de cierre — sobrante",
              notes: `Conciliación automática al cerrar. Esperado ${expected.toString()}, declarado ${declared.toString()}.`,
              created_by: actor?.name ?? null,
              cash_register_session_id: closed.id,
            },
          });
        }
      }

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
    // Split por método: cash entra al esperado en caja física; bold
    // entra al neto Bold del día. total = cash + bold.
    extra_income_cash: number;
    extra_income_bold: number;
    luggage_total: number;
    luggage_cash: number;
    luggage_bold: number;
    expenses_by_method: Record<PaymentMethod, number>;
    expenses_total: number;
    expenses_count: number;
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

    // Extras (ingresos baño / manual / etc) atribuidos a esta sesión,
    // separados por método: efectivo → esperado en caja; Bold (tarjeta
    // o QR) → neto Bold del día.
    const extrasByMethod = await this.prisma.extraIncome.groupBy({
      by: ["method"],
      where: {
        cash_register_session_id: sessionId,
        status: "active",
      },
      _sum: { total_amount: true },
    });
    let extraCash = 0;
    let extraBold = 0;
    for (const row of extrasByMethod) {
      const amount = Number(row._sum.total_amount ?? 0);
      if (row.method === PaymentMethod.efectivo) extraCash += amount;
      else extraBold += amount;
    }

    // Luggage (cobros de guardarropa) atribuidos a esta sesión,
    // separados por método: efectivo entra al esperado en caja, Bold
    // al neto Bold del día.
    const luggageByMethod = await this.prisma.luggageTicket.groupBy({
      by: ["method"],
      where: {
        cash_register_session_id: sessionId,
        payment_status: "paid",
      },
      _sum: { amount: true },
    });
    let luggageCash = 0;
    let luggageBold = 0;
    for (const row of luggageByMethod) {
      const amount = Number(row._sum.amount ?? 0);
      if (row.method === PaymentMethod.efectivo) luggageCash += amount;
      else luggageBold += amount;
    }

    // Gastos atribuidos a esta sesión (netos: kind=expense suma,
    // kind=reversal resta). El service de Expenses encapsula la lógica.
    const expensesSummary = await this.expenses.summaryForSession(sessionId);

    return {
      session,
      totals_by_method,
      payments_count: paymentsCount,
      extra_income_total: extraCash + extraBold,
      extra_income_cash: extraCash,
      extra_income_bold: extraBold,
      luggage_total: luggageCash + luggageBold,
      luggage_cash: luggageCash,
      luggage_bold: luggageBold,
      expenses_by_method: expensesSummary.by_method,
      expenses_total: expensesSummary.total,
      expenses_count: expensesSummary.count,
    };
  }
}
