import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from "@nestjs/common";
import {
  CashRegisterStatus,
  Expense,
  ExpenseCategory,
  ExpenseKind,
  PaymentMethod,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { OutboxEventService } from "../outbox/outbox-event.service";
import { CreateExpenseDto } from "./dto/create-expense.dto";
import {
  serializeExpenseForOutbox,
  serializeExpenseReversalForOutbox,
} from "./outbox-payload";

type Tx = Prisma.TransactionClient;

export type Actor = { user_id: number; name: string } | null;

/**
 * ExpensesService — Fase A+ Gastos v1.
 *
 * Maneja egresos de caja registrados durante la operación:
 * reposición de productos, insumos, mantenimiento, servicios pagados
 * en el momento.
 *
 * Reglas:
 *   - Cada Expense se atribuye a la CashRegisterSession ABIERTA
 *     actual. Si no hay jornada abierta, falla con 412.
 *   - Append-only: no hay UPDATE ni DELETE. Las correcciones se
 *     hacen creando una fila kind='reversal' con amount opuesto.
 *   - amount POSITIVO en `kind=expense`, NEGATIVO en `kind=reversal`.
 *     El consumer cloud netea con SUM.
 *   - Cada create emite outbox `expense.created` o `expense.reversed`
 *     dentro de la misma tx.
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxEventService,
  ) {}

  /**
   * Crear un Expense en la jornada abierta. Si no hay jornada
   * abierta, lanza 412 CASH_REGISTER_CLOSED para guiar al cajero
   * (mismo código que el guard genérico, así el frontend ya sabe
   * cómo mostrarlo).
   */
  async create(dto: CreateExpenseDto, actor: Actor): Promise<Expense> {
    return this.prisma.$transaction(async (tx) => {
      const cashSession = await tx.cashRegisterSession.findFirst({
        where: { status: CashRegisterStatus.open },
      });
      if (!cashSession) {
        throw new PreconditionFailedException({
          message:
            "Cash register is closed. Open the day before registering expenses.",
          code: "CASH_REGISTER_CLOSED",
        });
      }

      const created = await tx.expense.create({
        data: {
          cash_register_session_id: cashSession.id,
          method: dto.method,
          category: dto.category,
          kind: ExpenseKind.expense,
          amount: new Prisma.Decimal(dto.amount),
          concept: dto.concept.trim(),
          supplier: dto.supplier?.trim() || null,
          receipt_number: dto.receipt_number?.trim() || null,
          notes: dto.notes?.trim() || null,
          created_by: actor?.name ?? null,
        },
      });

      await this.outbox.enqueue(tx, {
        event_type: "expense.created",
        aggregate_type: "Expense",
        aggregate_id: created.external_id,
        payload: serializeExpenseForOutbox(created),
      });

      return created;
    });
  }

  /**
   * Reversar un Expense previo. Reglas:
   *   - El original NO puede ser un reversal (no se reversan reversos).
   *   - Solo se permite UN reverso por Expense (UNIQUE en reverses_id).
   *   - El reverso se atribuye al día contable ABIERTO actual (no al
   *     del Expense original): la plata "vuelve" a la caja de HOY.
   *   - El método y categoría se copian del original (para que el cierre
   *     netee correctamente sin asumir nada del operador).
   */
  async reverse(
    expenseId: number,
    input: { reason: string; actor: Actor },
  ): Promise<Expense> {
    const reason = input.reason.trim();
    if (reason.length < 3) {
      throw new BadRequestException({
        message: "Reason is required (min 3 chars)",
        code: "EXPENSE_REVERSE_REASON_REQUIRED",
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const original = await tx.expense.findUnique({
        where: { id: expenseId },
      });
      if (!original) {
        throw new NotFoundException({
          message: `Expense ${expenseId} not found`,
          code: "EXPENSE_NOT_FOUND",
        });
      }
      if (original.kind === ExpenseKind.reversal) {
        throw new BadRequestException({
          message: "Cannot reverse a reversal",
          code: "EXPENSE_REVERSE_OF_REVERSAL",
        });
      }

      const existing = await tx.expense.findUnique({
        where: { reverses_id: expenseId },
      });
      if (existing) {
        throw new ConflictException({
          message: `Expense ${expenseId} already reversed by ${existing.id}`,
          code: "EXPENSE_ALREADY_REVERSED",
          existing_reversal_id: existing.id,
        });
      }

      const cashSession = await tx.cashRegisterSession.findFirst({
        where: { status: CashRegisterStatus.open },
      });
      if (!cashSession) {
        throw new PreconditionFailedException({
          message:
            "Cash register is closed. Open the day before reversing expenses.",
          code: "CASH_REGISTER_CLOSED",
        });
      }

      const negativeAmount = new Prisma.Decimal(original.amount).neg();

      const reversal = await tx.expense.create({
        data: {
          cash_register_session_id: cashSession.id,
          method: original.method,
          category: original.category,
          kind: ExpenseKind.reversal,
          amount: negativeAmount,
          concept: `Reverso: ${original.concept}`,
          supplier: original.supplier,
          receipt_number: original.receipt_number,
          notes: null,
          reverses_id: original.id,
          reverse_reason: reason,
          created_by: input.actor?.name ?? null,
        },
      });

      await this.outbox.enqueue(tx, {
        event_type: "expense.reversed",
        aggregate_type: "Expense",
        aggregate_id: reversal.external_id,
        payload: serializeExpenseReversalForOutbox(
          reversal,
          original.external_id,
        ),
      });

      return reversal;
    });
  }

  /**
   * Listar Expenses con filtros. Si `session_id` se omite, devuelve
   * todos los del rango de fechas. Orden cronológico descendente.
   */
  async list(opts: {
    session_id?: number;
    method?: PaymentMethod;
    category?: ExpenseCategory;
    from?: Date;
    to?: Date;
    limit?: number;
  }): Promise<Expense[]> {
    const where: Prisma.ExpenseWhereInput = {};
    if (opts.session_id !== undefined) {
      where.cash_register_session_id = opts.session_id;
    }
    if (opts.method) where.method = opts.method;
    if (opts.category) where.category = opts.category;
    if (opts.from || opts.to) {
      where.created_at = {};
      if (opts.from) where.created_at.gte = opts.from;
      if (opts.to) where.created_at.lt = opts.to;
    }
    return this.prisma.expense.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: opts.limit && opts.limit > 0 ? Math.min(opts.limit, 200) : 100,
    });
  }

  /**
   * Aggregate por método y categoría para una sesión específica.
   * Devuelve totales NETOS (kind=expense - kind=reversal). Usado por:
   *   - El ticket de cierre de jornada (sección "Egresos" con
   *     subtotales por método).
   *   - El tab Caja del histórico.
   *   - El cálculo de `expected` en CashRegisterService.close().
   *
   * El sumtotal por método se calcula nativo en SQL (SUM con signo
   * baked-in vía amount opuesto en reversals).
   */
  async summaryForSession(sessionId: number): Promise<{
    by_method: Record<PaymentMethod, number>;
    by_category: Record<ExpenseCategory, number>;
    total: number;
    count: number;
  }> {
    const rows = await this.prisma.expense.findMany({
      where: { cash_register_session_id: sessionId },
      select: { method: true, category: true, amount: true, kind: true },
    });

    const by_method: Record<PaymentMethod, number> = {
      [PaymentMethod.efectivo]: 0,
      [PaymentMethod.tarjeta_bold]: 0,
      [PaymentMethod.qr_bold]: 0,
    };
    const by_category: Record<ExpenseCategory, number> = {
      [ExpenseCategory.mercancia]: 0,
      [ExpenseCategory.insumos]: 0,
      [ExpenseCategory.mantenimiento]: 0,
      [ExpenseCategory.servicios]: 0,
      [ExpenseCategory.personal]: 0,
      [ExpenseCategory.otros]: 0,
    };
    let total = 0;
    // count: solo cuenta egresos "vivos" (no reversados todavía). Para
    // ese cálculo necesitamos saber qué expense_ids tienen reverso.
    const reversedIds = new Set<number>();
    const allWithReverses = await this.prisma.expense.findMany({
      where: { cash_register_session_id: sessionId, reverses_id: { not: null } },
      select: { reverses_id: true },
    });
    for (const r of allWithReverses) {
      if (r.reverses_id != null) reversedIds.add(r.reverses_id);
    }

    for (const r of rows) {
      const amt = Number(r.amount);
      by_method[r.method] += amt;
      by_category[r.category] += amt;
      total += amt;
    }
    // count: solo expense vivos (no reversals y no aún reversados).
    // Util para el ticket: "3 egresos por $50k" en vez de mostrar 6
    // filas (3 originales + 3 reversos) si todo fue reversado.
    const liveExpenses = await this.prisma.expense.findMany({
      where: {
        cash_register_session_id: sessionId,
        kind: ExpenseKind.expense,
      },
      select: { id: true },
    });
    const count = liveExpenses.filter((r) => !reversedIds.has(r.id)).length;

    return { by_method, by_category, total, count };
  }
}
