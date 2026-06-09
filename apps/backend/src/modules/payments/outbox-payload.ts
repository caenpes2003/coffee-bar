import { Payment } from "@prisma/client";

/**
 * Payload de `payment.created` para el OutboxEvent.
 *
 * Ver MIGRACION_SYNC.md "Fase A+" para racional.
 *
 * Shape plano y estable: snapshot del Payment recién creado. Mismo
 * principio que `serializeConsumptionForOutbox`. Decimal → number,
 * DateTime → ISO string. Nullables como `null`.
 *
 * NO incluye relaciones expandidas (Consumption, TableSession,
 * CashRegisterSession) — sus IDs alcanzan; el consumer cloud
 * resuelve por FK si necesita.
 */
export type PaymentCreatedPayload = {
  id: number;
  external_id: string;
  table_session_id: number;
  cash_register_session_id: number;
  method: string;
  kind: string;
  amount: number;
  consumption_id: number | null;
  reference: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export function serializePaymentForOutbox(
  payment: Payment,
): PaymentCreatedPayload {
  return {
    id: payment.id,
    external_id: payment.external_id,
    table_session_id: payment.table_session_id,
    cash_register_session_id: payment.cash_register_session_id,
    method: payment.method,
    kind: payment.kind,
    amount: Number(payment.amount),
    consumption_id: payment.consumption_id,
    reference: payment.reference,
    notes: payment.notes,
    created_by: payment.created_by,
    created_at: payment.created_at.toISOString(),
  };
}

/**
 * Payload de `payment.reversed`. Snapshot de la fila de reverso
 * recién creada + referencia al Payment original que anula
 * (`reverses_external_id`). El amount viene con signo opuesto al
 * original (positivo→negativo) para que el consumer cloud netee
 * con una simple suma sin tener que rastrear linked rows.
 */
export type PaymentReversedPayload = {
  id: number;
  external_id: string;
  reverses_external_id: string;
  table_session_id: number;
  cash_register_session_id: number;
  method: string;
  amount: number;
  reverse_reason: string;
  reverse_reason_detail: string | null;
  created_by: string | null;
  created_at: string;
};

export function serializePaymentReversalForOutbox(
  reversal: Payment,
  reversesExternalId: string,
): PaymentReversedPayload {
  return {
    id: reversal.id,
    external_id: reversal.external_id,
    reverses_external_id: reversesExternalId,
    table_session_id: reversal.table_session_id,
    cash_register_session_id: reversal.cash_register_session_id,
    method: reversal.method,
    amount: Number(reversal.amount),
    reverse_reason: reversal.reverse_reason ?? "other",
    reverse_reason_detail: reversal.reverse_reason_detail,
    created_by: reversal.created_by,
    created_at: reversal.created_at.toISOString(),
  };
}
