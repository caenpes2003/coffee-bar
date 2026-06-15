import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  Expense,
  ExpenseCategory,
  PaymentMethod,
} from "@prisma/client";
import { CurrentAuth } from "../auth/guards/current-auth.decorator";
import { AuthKinds } from "../auth/guards/decorators";
import { JwtGuard } from "../auth/guards/jwt.guard";
import type { AuthPayload } from "../auth/types";
import { CreateExpenseDto } from "./dto/create-expense.dto";
import { ReverseExpenseDto } from "./dto/reverse-expense.dto";
import { ExpensesService } from "./expenses.service";

/**
 * Endpoints de Expenses (Fase A+ Gastos v1):
 *
 *   POST  /admin/expenses                      registrar gasto
 *   POST  /admin/expenses/:id/reverse          reversar gasto
 *   GET   /admin/expenses                      listar con filtros
 *   GET   /admin/expenses/session/:id/summary  totales por método/categoría
 *
 * Todos requieren admin auth. El service valida internamente la
 * existencia de jornada abierta (412 CASH_REGISTER_CLOSED) — no hace
 * falta aplicar RequireOpenCashRegisterGuard explícitamente porque
 * el error que devolveríamos sería idéntico.
 */
@Controller("admin/expenses")
@UseGuards(JwtGuard)
@AuthKinds("admin")
export class ExpensesController {
  constructor(private readonly service: ExpensesService) {}

  @Post()
  async create(
    @Body() dto: CreateExpenseDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    const actor = toActor(auth);
    const expense = await this.service.create(dto, actor);
    return serialize(expense);
  }

  @Post(":id/reverse")
  async reverse(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ReverseExpenseDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    const reversal = await this.service.reverse(id, {
      reason: dto.reason,
      actor: toActor(auth),
    });
    return serialize(reversal);
  }

  @Get()
  async list(
    @Query("session_id") sessionIdRaw?: string,
    @Query("method") methodRaw?: string,
    @Query("category") categoryRaw?: string,
    @Query("from") fromRaw?: string,
    @Query("to") toRaw?: string,
    @Query("limit") limitRaw?: string,
  ) {
    const items = await this.service.list({
      session_id: sessionIdRaw ? parseIntStrict(sessionIdRaw, "session_id") : undefined,
      method: parseMethod(methodRaw),
      category: parseCategory(categoryRaw),
      from: parseDate(fromRaw, "from"),
      to: parseDate(toRaw, "to"),
      limit: limitRaw ? parseIntStrict(limitRaw, "limit") : undefined,
    });
    return items.map(serialize);
  }

  @Get("session/:id/summary")
  async summary(@Param("id", ParseIntPipe) id: number) {
    return this.service.summaryForSession(id);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function toActor(
  auth: AuthPayload | undefined,
): { user_id: number; name: string } | null {
  if (!auth || auth.kind !== "admin") return null;
  return { user_id: auth.sub, name: auth.name };
}

/**
 * Decimal → number, DateTime → ISO. Mismo shape que el tipo Expense
 * declarado en @coffee-bar/shared y consumido por expensesApi.
 */
function serialize(e: Expense) {
  return {
    id: e.id,
    external_id: e.external_id,
    cash_register_session_id: e.cash_register_session_id,
    method: e.method,
    category: e.category,
    kind: e.kind,
    amount: Number(e.amount),
    concept: e.concept,
    supplier: e.supplier,
    receipt_number: e.receipt_number,
    notes: e.notes,
    reverses_id: e.reverses_id,
    reverse_reason: e.reverse_reason,
    created_by: e.created_by,
    created_at: e.created_at.toISOString(),
  };
}

function parseMethod(v: string | undefined): PaymentMethod | undefined {
  if (!v) return undefined;
  if (v === "efectivo") return PaymentMethod.efectivo;
  if (v === "tarjeta_bold") return PaymentMethod.tarjeta_bold;
  if (v === "qr_bold") return PaymentMethod.qr_bold;
  throw new BadRequestException({
    message: `Invalid method: ${v}`,
    code: "EXPENSE_INVALID_METHOD",
  });
}

function parseCategory(v: string | undefined): ExpenseCategory | undefined {
  if (!v) return undefined;
  const valid: ExpenseCategory[] = [
    ExpenseCategory.mercancia,
    ExpenseCategory.insumos,
    ExpenseCategory.mantenimiento,
    ExpenseCategory.servicios,
    ExpenseCategory.personal,
    ExpenseCategory.otros,
  ];
  if (valid.includes(v as ExpenseCategory)) return v as ExpenseCategory;
  throw new BadRequestException({
    message: `Invalid category: ${v}`,
    code: "EXPENSE_INVALID_CATEGORY",
  });
}

function parseDate(v: string | undefined, field: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException({
      message: `Invalid date in '${field}'`,
      code: "EXPENSE_INVALID_DATE",
    });
  }
  return d;
}

function parseIntStrict(v: string, field: string): number {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new BadRequestException({
      message: `Invalid '${field}'`,
      code: "EXPENSE_INVALID_PARAM",
    });
  }
  return n;
}
