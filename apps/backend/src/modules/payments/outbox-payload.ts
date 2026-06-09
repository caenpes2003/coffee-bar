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
