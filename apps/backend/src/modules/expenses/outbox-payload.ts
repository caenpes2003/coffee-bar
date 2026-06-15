import { Expense } from "@prisma/client";

/**
 * Payload de `expense.created` y `expense.reversed` para el OutboxEvent.
 *
 * Shape plano y estable: snapshot del Expense recién creado. Mismo
 * principio que serializePaymentForOutbox: Decimal → number,
 * DateTime → ISO string, nullables como `null`.
 *
 * Nota sobre signo del amount: para kind='expense' viene positivo;
 * para kind='reversal' viene negativo. El consumer cloud netea con
 * una simple suma sin tener que rastrear linked rows.
 */
export type ExpenseCreatedPayload = {
  id: number;
  external_id: string;
  cash_register_session_id: number;
  method: string;
  category: string;
  kind: string;
  amount: number;
  concept: string;
  supplier: string | null;
  receipt_number: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export function serializeExpenseForOutbox(
  expense: Expense,
): ExpenseCreatedPayload {
  return {
    id: expense.id,
    external_id: expense.external_id,
    cash_register_session_id: expense.cash_register_session_id,
    method: expense.method,
    category: expense.category,
    kind: expense.kind,
    amount: Number(expense.amount),
    concept: expense.concept,
    supplier: expense.supplier,
    receipt_number: expense.receipt_number,
    notes: expense.notes,
    created_by: expense.created_by,
    created_at: expense.created_at.toISOString(),
  };
}

/**
 * Payload de `expense.reversed`. Snapshot del reverso + referencia
 * al Expense original que anula (`reverses_external_id`). El amount
 * viene NEGATIVO.
 */
export type ExpenseReversedPayload = {
  id: number;
  external_id: string;
  reverses_external_id: string;
  cash_register_session_id: number;
  method: string;
  category: string;
  amount: number;
  reverse_reason: string;
  created_by: string | null;
  created_at: string;
};

export function serializeExpenseReversalForOutbox(
  reversal: Expense,
  reversesExternalId: string,
): ExpenseReversedPayload {
  return {
    id: reversal.id,
    external_id: reversal.external_id,
    reverses_external_id: reversesExternalId,
    cash_register_session_id: reversal.cash_register_session_id,
    method: reversal.method,
    category: reversal.category,
    amount: Number(reversal.amount),
    reverse_reason: reversal.reverse_reason ?? "",
    created_by: reversal.created_by,
    created_at: reversal.created_at.toISOString(),
  };
}
