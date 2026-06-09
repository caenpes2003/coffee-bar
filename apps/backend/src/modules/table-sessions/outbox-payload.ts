import { TableSession } from "@prisma/client";

/**
 * Payload de los eventos `session.*` para el OutboxEvent.
 *
 * Diseñado plano y estable según la regla del commit 6: snapshot
 * completo de la fila TableSession en JSON serializable, sin
 * relaciones anidadas (Table, orders, consumptions). Mismo principio
 * que aplicamos en consumption: shape predecible sobre exhaustividad.
 *
 * Decisiones de tipo:
 *   - `Decimal` (`total_consumption`) se castea a `number` con
 *     `Number()` para que el JSON quede numérico, no string.
 *   - Todos los `DateTime` se serializan con `.toISOString()` explícito
 *     (en vez de confiar en JSON.stringify de Date) para que el formato
 *     sea determinístico y consultable como string en SQL si hace falta.
 *   - Nullable fields se conservan como `null` (no `undefined`).
 *
 * Lo que NO incluye (deliberado):
 *   - `Table.kind` (TABLE/BAR): vive en la tabla padre. Si el cloud
 *     necesita saber si es BAR, lo deriva por `table_id` cuando ingiera
 *     el evento (la tabla `Table` también se replica). Evitamos joins
 *     que compliquen el outbox.
 *   - Conteos derivados (`order_count`, etc.): si el cloud los necesita,
 *     los calcula post-ingestión.
 */
export type SessionEventPayload = {
  id: number;
  external_id: string;
  table_id: number;
  status: string;
  total_consumption: number;
  last_consumption_at: string | null;
  opened_at: string;
  closed_at: string | null;
  payment_requested_at: string | null;
  paid_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  void_other_detail: string | null;
  voided_by: string | null;
  custom_name: string | null;
  opened_by: string;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

/**
 * Convierte una fila `TableSession` (recién creada o actualizada por
 * Prisma) en el payload que el outbox espera. Usado por los 4
 * productores de `session.*` para evitar inconsistencias de shape
 * entre call sites.
 */
export function serializeSessionForOutbox(
  session: TableSession,
): SessionEventPayload {
  return {
    id: session.id,
    external_id: session.external_id,
    table_id: session.table_id,
    status: session.status,
    total_consumption: Number(session.total_consumption),
    last_consumption_at:
      session.last_consumption_at?.toISOString() ?? null,
    opened_at: session.opened_at.toISOString(),
    closed_at: session.closed_at?.toISOString() ?? null,
    payment_requested_at:
      session.payment_requested_at?.toISOString() ?? null,
    paid_at: session.paid_at?.toISOString() ?? null,
    voided_at: session.voided_at?.toISOString() ?? null,
    void_reason: session.void_reason,
    void_other_detail: session.void_other_detail,
    voided_by: session.voided_by,
    custom_name: session.custom_name,
    opened_by: session.opened_by,
    metadata: session.metadata,
    created_at: session.created_at.toISOString(),
    updated_at: session.updated_at.toISOString(),
  };
}
