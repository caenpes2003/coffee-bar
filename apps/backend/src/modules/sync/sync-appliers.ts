import {
  ConsumptionType,
  ExpenseCategory,
  ExpenseKind,
  ExtraIncomeStatus,
  ExtraIncomeType,
  LuggagePaymentStatus,
  LuggageStatus,
  CashRegisterStatus,
  PaymentKind,
  PaymentMethod,
  Prisma,
  SessionVoidReason,
  TableSessionStatus,
} from "@prisma/client";

/**
 * Appliers (Fase 2 del sync): traducen cada event_type del InboxEvent
 * a upserts sobre las tablas del nodo receptor (el cloud), para que el
 * backoffice refleje lo que pasó en el bar.
 *
 * Reglas de diseño:
 *   - TODO se resuelve por external_id — los ints del payload son PKs
 *     locales del emisor y solo sirven para debug. La excepción es el
 *     CATÁLOGO (product_id, table_id): sus PKs son estables entre
 *     nodos porque el catálogo se replica por PK (§7 ARQUITECTURA).
 *   - Idempotencia de entidad: crear-si-no-existe / upsert por
 *     external_id. Re-aplicar un evento ya aplicado es un no-op.
 *     Las filas creadas CONSERVAN el external_id del emisor — es la
 *     identidad global de la entidad.
 *   - Padre no llegó todavía → MissingParentError: el aplicador deja
 *     el evento `received` con backoff y lo reintenta (el orden de
 *     emisión hace que casi nunca pase; cubre lotes con fallas
 *     parciales).
 *   - Los eventos snapshot (session.*, cash_register.*) PISAN el
 *     estado con el snapshot completo — último evento gana, que con
 *     aplicación en orden reproduce el estado final correcto.
 *   - Los appliers NO recalculan agregados ni tocan Product.stock
 *     (§5.5: el stock cross-nodo se reconcilia por replay del ledger
 *     de InventoryMovement, jamás copiando el campo).
 */

export class MissingParentError extends Error {
  constructor(what: string) {
    super(`missing parent: ${what}`);
    this.name = "MissingParentError";
  }
}

type Tx = Prisma.TransactionClient;
type Payload = Record<string, unknown>;
export type Applier = (tx: Tx, payload: Payload) => Promise<void>;

// ─── Helpers ──────────────────────────────────────────────────────────────

function str(p: Payload, key: string): string {
  const v = p[key];
  if (typeof v !== "string") throw new Error(`payload.${key} must be string`);
  return v;
}
function strOrNull(p: Payload, key: string): string | null {
  const v = p[key];
  return typeof v === "string" ? v : null;
}
function num(p: Payload, key: string): number {
  const v = p[key];
  if (typeof v !== "number") throw new Error(`payload.${key} must be number`);
  return v;
}
function numOrNull(p: Payload, key: string): number | null {
  const v = p[key];
  return typeof v === "number" ? v : null;
}
function date(p: Payload, key: string): Date {
  return new Date(str(p, key));
}
function dateOrNull(p: Payload, key: string): Date | null {
  const v = strOrNull(p, key);
  return v !== null ? new Date(v) : null;
}

async function resolveSession(tx: Tx, externalId: string): Promise<number> {
  const row = await tx.tableSession.findUnique({
    where: { external_id: externalId },
    select: { id: true },
  });
  if (!row) throw new MissingParentError(`TableSession ${externalId}`);
  return row.id;
}

async function resolveCashSession(
  tx: Tx,
  externalId: string,
): Promise<number> {
  const row = await tx.cashRegisterSession.findUnique({
    where: { external_id: externalId },
    select: { id: true },
  });
  if (!row) {
    throw new MissingParentError(`CashRegisterSession ${externalId}`);
  }
  return row.id;
}

async function resolveConsumption(
  tx: Tx,
  externalId: string,
): Promise<number> {
  const row = await tx.consumption.findUnique({
    where: { external_id: externalId },
    select: { id: true },
  });
  if (!row) throw new MissingParentError(`Consumption ${externalId}`);
  return row.id;
}

async function alreadyExists(
  tx: Tx,
  model: "consumption" | "payment" | "expense" | "extraIncome" | "luggageTicket" | "inventoryMovement" | "partialPaymentAllocation",
  externalId: string,
): Promise<boolean> {
  // Nota: los delegates comparten shape de findUnique por external_id.
  const delegate = tx[model] as unknown as {
    findUnique: (args: {
      where: { external_id: string };
      select: { id: true };
    }) => Promise<{ id: number } | null>;
  };
  const row = await delegate.findUnique({
    where: { external_id: externalId },
    select: { id: true },
  });
  return row !== null;
}

// ─── Snapshot de TableSession (session.*) ────────────────────────────────

const applySessionSnapshot: Applier = async (tx, p) => {
  const data = {
    table_id: num(p, "table_id"),
    status: str(p, "status") as TableSessionStatus,
    total_consumption: new Prisma.Decimal(num(p, "total_consumption")),
    last_consumption_at: dateOrNull(p, "last_consumption_at"),
    opened_at: date(p, "opened_at"),
    closed_at: dateOrNull(p, "closed_at"),
    payment_requested_at: dateOrNull(p, "payment_requested_at"),
    paid_at: dateOrNull(p, "paid_at"),
    voided_at: dateOrNull(p, "voided_at"),
    void_reason: strOrNull(p, "void_reason") as SessionVoidReason | null,
    void_other_detail: strOrNull(p, "void_other_detail"),
    voided_by: strOrNull(p, "voided_by"),
    custom_name: strOrNull(p, "custom_name"),
    opened_by: str(p, "opened_by"),
  };
  await tx.tableSession.upsert({
    where: { external_id: str(p, "external_id") },
    create: { external_id: str(p, "external_id"), ...data },
    update: data,
  });
};

// ─── Registro de appliers ────────────────────────────────────────────────

export const SYNC_APPLIERS: Record<string, Applier> = {
  "session.opened": applySessionSnapshot,
  "session.marked_paid": applySessionSnapshot,
  "session.closed": applySessionSnapshot,
  "session.voided": applySessionSnapshot,
  "session.transferred": applySessionSnapshot,

  "consumption.created": async (tx, p) => {
    const externalId = str(p, "external_id");
    if (await alreadyExists(tx, "consumption", externalId)) return;
    const sessionId = await resolveSession(
      tx,
      str(p, "table_session_external_id"),
    );
    const cashExternal = strOrNull(p, "cash_register_session_external_id");
    const cashId =
      cashExternal !== null
        ? await resolveCashSession(tx, cashExternal)
        : null;
    const reversesExternal = strOrNull(p, "reverses_external_id");
    const reversesId =
      reversesExternal !== null
        ? await resolveConsumption(tx, reversesExternal)
        : null;
    await tx.consumption.create({
      data: {
        external_id: externalId,
        table_session_id: sessionId,
        cash_register_session_id: cashId,
        // Orders no se replican todavía: el vínculo a la orden queda
        // null en el cloud; el detalle vive en description/quantity.
        order_id: null,
        product_id: numOrNull(p, "product_id"),
        description: str(p, "description"),
        quantity: num(p, "quantity"),
        unit_amount: new Prisma.Decimal(num(p, "unit_amount")),
        amount: new Prisma.Decimal(num(p, "amount")),
        type: str(p, "type") as ConsumptionType,
        reverses_id: reversesId,
        reason: strOrNull(p, "reason"),
        notes: strOrNull(p, "notes"),
        created_by: strOrNull(p, "created_by"),
        created_at: date(p, "created_at"),
      },
    });
    // Si esta fila es un refund, marcar la original como reversada
    // (en el nodo emisor eso lo hizo el service; acá lo reproduce el
    // applier para que el ledger espejo sea consistente).
    if (reversesId !== null) {
      await tx.consumption.updateMany({
        where: { id: reversesId, reversed_at: null },
        data: { reversed_at: date(p, "created_at") },
      });
    }
  },

  "payment.created": async (tx, p) => {
    const externalId = str(p, "external_id");
    if (await alreadyExists(tx, "payment", externalId)) return;
    const sessionId = await resolveSession(
      tx,
      str(p, "table_session_external_id"),
    );
    const cashId = await resolveCashSession(
      tx,
      str(p, "cash_register_session_external_id"),
    );
    const consumptionExternal = strOrNull(p, "consumption_external_id");
    const consumptionId =
      consumptionExternal !== null
        ? await resolveConsumption(tx, consumptionExternal)
        : null;
    await tx.payment.create({
      data: {
        external_id: externalId,
        table_session_id: sessionId,
        cash_register_session_id: cashId,
        method: str(p, "method") as PaymentMethod,
        kind: str(p, "kind") as PaymentKind,
        amount: new Prisma.Decimal(num(p, "amount")),
        consumption_id: consumptionId,
        reference: strOrNull(p, "reference"),
        notes: strOrNull(p, "notes"),
        created_by: strOrNull(p, "created_by"),
        created_at: date(p, "created_at"),
      },
    });
  },

  "payment.reversed": async (tx, p) => {
    const externalId = str(p, "external_id");
    if (await alreadyExists(tx, "payment", externalId)) return;
    const original = await tx.payment.findUnique({
      where: { external_id: str(p, "reverses_external_id") },
      select: { id: true },
    });
    if (!original) {
      throw new MissingParentError(
        `Payment ${str(p, "reverses_external_id")}`,
      );
    }
    const sessionId = await resolveSession(
      tx,
      str(p, "table_session_external_id"),
    );
    const cashId = await resolveCashSession(
      tx,
      str(p, "cash_register_session_external_id"),
    );
    await tx.payment.create({
      data: {
        external_id: externalId,
        table_session_id: sessionId,
        cash_register_session_id: cashId,
        method: str(p, "method") as PaymentMethod,
        kind: PaymentKind.reversal,
        amount: new Prisma.Decimal(num(p, "amount")),
        consumption_id: null,
        reverses_id: original.id,
        reverse_reason: str(p, "reverse_reason") as never,
        reverse_reason_detail: strOrNull(p, "reverse_reason_detail"),
        created_by: strOrNull(p, "created_by"),
        created_at: date(p, "created_at"),
      },
    });
  },

  "cash_register.opened": async (tx, p) => {
    await applyCashRegisterSnapshot(tx, p);
  },
  "cash_register.closed": async (tx, p) => {
    await applyCashRegisterSnapshot(tx, p);
  },

  "expense.created": async (tx, p) => {
    const externalId = str(p, "external_id");
    if (await alreadyExists(tx, "expense", externalId)) return;
    const cashId = await resolveCashSession(
      tx,
      str(p, "cash_register_session_external_id"),
    );
    await tx.expense.create({
      data: {
        external_id: externalId,
        cash_register_session_id: cashId,
        method: str(p, "method") as PaymentMethod,
        category: str(p, "category") as ExpenseCategory,
        kind: str(p, "kind") as ExpenseKind,
        amount: new Prisma.Decimal(num(p, "amount")),
        concept: str(p, "concept"),
        supplier: strOrNull(p, "supplier"),
        receipt_number: strOrNull(p, "receipt_number"),
        notes: strOrNull(p, "notes"),
        created_by: strOrNull(p, "created_by"),
        created_at: date(p, "created_at"),
      },
    });
  },

  "expense.reversed": async (tx, p) => {
    const externalId = str(p, "external_id");
    if (await alreadyExists(tx, "expense", externalId)) return;
    const original = await tx.expense.findUnique({
      where: { external_id: str(p, "reverses_external_id") },
      select: { id: true, concept: true, supplier: true },
    });
    if (!original) {
      throw new MissingParentError(
        `Expense ${str(p, "reverses_external_id")}`,
      );
    }
    const cashId = await resolveCashSession(
      tx,
      str(p, "cash_register_session_external_id"),
    );
    await tx.expense.create({
      data: {
        external_id: externalId,
        cash_register_session_id: cashId,
        method: str(p, "method") as PaymentMethod,
        category: str(p, "category") as ExpenseCategory,
        kind: ExpenseKind.reversal,
        amount: new Prisma.Decimal(num(p, "amount")),
        concept: `Reverso: ${original.concept}`,
        supplier: original.supplier,
        reverses_id: original.id,
        reverse_reason: str(p, "reverse_reason"),
        created_by: strOrNull(p, "created_by"),
        created_at: date(p, "created_at"),
      },
    });
  },

  "extra_income.created": async (tx, p) => {
    const externalId = str(p, "external_id");
    if (await alreadyExists(tx, "extraIncome", externalId)) return;
    const cashId = await resolveCashSession(
      tx,
      str(p, "cash_register_session_external_id"),
    );
    await tx.extraIncome.create({
      data: {
        external_id: externalId,
        type: str(p, "type") as ExtraIncomeType,
        subtype: strOrNull(p, "subtype"),
        method: str(p, "method") as PaymentMethod,
        amount: new Prisma.Decimal(num(p, "amount")),
        quantity: num(p, "quantity"),
        total_amount: new Prisma.Decimal(num(p, "total_amount")),
        status: ExtraIncomeStatus.active,
        cash_register_session_id: cashId,
        concept: strOrNull(p, "concept"),
        created_by: strOrNull(p, "created_by"),
        created_at: date(p, "created_at"),
      },
    });
  },

  "extra_income.reversed": async (tx, p) => {
    const externalId = str(p, "external_id");
    const updated = await tx.extraIncome.updateMany({
      where: { external_id: externalId },
      data: {
        status: ExtraIncomeStatus.reversed,
        reversed_at: dateOrNull(p, "reversed_at") ?? new Date(),
        reversed_by: strOrNull(p, "reversed_by"),
        reverse_reason: str(p, "reverse_reason"),
      },
    });
    if (updated.count === 0) {
      throw new MissingParentError(`ExtraIncome ${externalId}`);
    }
  },

  "luggage.created": async (tx, p) => {
    const externalId = str(p, "external_id");
    if (await alreadyExists(tx, "luggageTicket", externalId)) return;
    const cashExternal = strOrNull(p, "cash_register_session_external_id");
    const cashId =
      cashExternal !== null
        ? await resolveCashSession(tx, cashExternal)
        : null;
    await tx.luggageTicket.create({
      data: {
        external_id: externalId,
        ticket_number: num(p, "ticket_number"),
        customer_first_name: strOrNull(p, "customer_first_name") ?? "",
        customer_last_name: strOrNull(p, "customer_last_name") ?? "",
        customer_phone: strOrNull(p, "customer_phone") ?? "",
        amount: new Prisma.Decimal(num(p, "amount")),
        payment_status: str(p, "payment_status") as LuggagePaymentStatus,
        method:
          (strOrNull(p, "method") as PaymentMethod | null) ??
          PaymentMethod.efectivo,
        status: LuggageStatus.active,
        cash_register_session_id: cashId,
        created_by: strOrNull(p, "created_by"),
        created_at: date(p, "created_at"),
      },
    });
  },

  "luggage.updated": async (tx, p) => {
    const externalId = str(p, "external_id");
    const updated = await tx.luggageTicket.updateMany({
      where: { external_id: externalId },
      data: {
        status: str(p, "status") as LuggageStatus,
        payment_status: str(p, "payment_status") as LuggagePaymentStatus,
        method:
          (strOrNull(p, "method") as PaymentMethod | null) ??
          PaymentMethod.efectivo,
        delivered_at: dateOrNull(p, "delivered_at"),
        delivered_by: strOrNull(p, "delivered_by"),
        incident_at: dateOrNull(p, "incident_at"),
        incident_by: strOrNull(p, "incident_by"),
        incident_reason: strOrNull(p, "incident_reason"),
      },
    });
    if (updated.count === 0) {
      throw new MissingParentError(`LuggageTicket ${externalId}`);
    }
  },

  "inventory.recorded": async (tx, p) => {
    const externalId = str(p, "external_id");
    if (await alreadyExists(tx, "inventoryMovement", externalId)) return;
    // §5.5: SOLO se materializa el movimiento (ledger). Product.stock
    // del receptor NO se toca — la reconciliación de stock es replay
    // del ledger, nunca copia del campo.
    await tx.inventoryMovement.create({
      data: {
        external_id: externalId,
        product_id: num(p, "product_id"),
        type: str(p, "type") as never,
        quantity: num(p, "quantity"),
        reason: strOrNull(p, "reason"),
        created_by: strOrNull(p, "created_by"),
        created_at: date(p, "created_at"),
      },
    });
  },

  "partial_payment.allocated": async (tx, p) => {
    const paymentConsumptionId = await resolveConsumption(
      tx,
      str(p, "payment_consumption_external_id"),
    );
    const allocations = p["allocations"];
    if (!Array.isArray(allocations)) {
      throw new Error("payload.allocations must be an array");
    }
    for (const raw of allocations) {
      const a = raw as Payload;
      const externalId = str(a, "external_id");
      if (await alreadyExists(tx, "partialPaymentAllocation", externalId)) {
        continue;
      }
      const productConsumptionId = await resolveConsumption(
        tx,
        str(a, "product_consumption_external_id"),
      );
      await tx.partialPaymentAllocation.create({
        data: {
          external_id: externalId,
          payment_consumption_id: paymentConsumptionId,
          product_consumption_id: productConsumptionId,
          quantity: num(a, "quantity"),
          amount: new Prisma.Decimal(num(a, "amount")),
        },
      });
    }
  },

  // Orders no se replican como entidades todavía (solo sus Consumption
  // derivados). El evento se acepta como no-op para que el inbox no lo
  // arrastre eternamente; cuando exista la réplica de Orders, este
  // applier se implementa de verdad y se re-aplican desde el histórico
  // si hace falta.
  "order.status_changed": async () => {
    return;
  },
};

async function applyCashRegisterSnapshot(tx: Tx, p: Payload): Promise<void> {
  const data = {
    status: str(p, "status") as CashRegisterStatus,
    opening_balance: new Prisma.Decimal(num(p, "opening_balance")),
    opened_at: date(p, "opened_at"),
    opened_by: strOrNull(p, "opened_by"),
    opened_via_bypass: p["opened_via_bypass"] === true,
    opened_bypass_reason: strOrNull(p, "opened_bypass_reason"),
    closed_at: dateOrNull(p, "closed_at"),
    closed_by: strOrNull(p, "closed_by"),
    closing_balance_declared:
      numOrNull(p, "closing_balance_declared") !== null
        ? new Prisma.Decimal(numOrNull(p, "closing_balance_declared")!)
        : null,
    closing_balance_expected:
      numOrNull(p, "closing_balance_expected") !== null
        ? new Prisma.Decimal(numOrNull(p, "closing_balance_expected")!)
        : null,
    difference:
      numOrNull(p, "difference") !== null
        ? new Prisma.Decimal(numOrNull(p, "difference")!)
        : null,
    notes: strOrNull(p, "notes"),
  };
  await tx.cashRegisterSession.upsert({
    where: { external_id: str(p, "external_id") },
    create: { external_id: str(p, "external_id"), ...data },
    update: data,
  });
}
