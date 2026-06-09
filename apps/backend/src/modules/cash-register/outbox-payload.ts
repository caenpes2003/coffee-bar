import { CashRegisterSession } from "@prisma/client";

/**
 * Payload de los eventos `cash_register.*` para el OutboxEvent.
 *
 * Mismo shape para `opened` y `closed` (snapshot completo). El
 * `event_type` distingue qué transición disparó el evento; el payload
 * trae todos los campos relevantes (los de cierre quedan en null si
 * la sesión está abierta).
 *
 * Decimal → number, DateTime → ISO string. Nullables como `null`.
 */
export type CashRegisterEventPayload = {
  id: number;
  external_id: string;
  status: string;
  opening_balance: number;
  opened_at: string;
  opened_by: string | null;
  opened_via_bypass: boolean;
  opened_bypass_reason: string | null;
  closed_at: string | null;
  closed_by: string | null;
  closing_balance_declared: number | null;
  closing_balance_expected: number | null;
  difference: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export function serializeCashRegisterForOutbox(
  session: CashRegisterSession,
): CashRegisterEventPayload {
  return {
    id: session.id,
    external_id: session.external_id,
    status: session.status,
    opening_balance: Number(session.opening_balance),
    opened_at: session.opened_at.toISOString(),
    opened_by: session.opened_by,
    opened_via_bypass: session.opened_via_bypass,
    opened_bypass_reason: session.opened_bypass_reason,
    closed_at: session.closed_at?.toISOString() ?? null,
    closed_by: session.closed_by,
    closing_balance_declared:
      session.closing_balance_declared !== null
        ? Number(session.closing_balance_declared)
        : null,
    closing_balance_expected:
      session.closing_balance_expected !== null
        ? Number(session.closing_balance_expected)
        : null,
    difference:
      session.difference !== null ? Number(session.difference) : null,
    notes: session.notes,
    created_at: session.created_at.toISOString(),
    updated_at: session.updated_at.toISOString(),
  };
}
