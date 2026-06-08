import { Consumption, Prisma } from "@prisma/client";

/**
 * Payload de `consumption.created` para el OutboxEvent.
 *
 * Diseñado plano y estable según la regla del commit 5: snapshot mínimo
 * y serializable, sin relaciones anidadas. Para el primer productor
 * preferimos un shape predecible sobre exhaustividad — siempre podemos
 * extender el schema del registry sin migration cuando aparezca
 * necesidad real.
 *
 * Decisiones de tipo:
 *   - `Decimal` de Prisma se castea a `number` con `Number()` para que
 *     el JSON serializado sea numérico (no string). El cloud que
 *     consuma estos eventos no debería tener que conocer Prisma.
 *   - `DateTime` se serializa con `.toISOString()` explícito (en vez
 *     de confiar en JSON.stringify de Date) para que el formato sea
 *     determinístico y consultable como string en SQL si hace falta.
 *   - Campos nullable de Prisma se mantienen como `null` (no
 *     `undefined`) — JSON puede llevar null pero no undefined.
 */
export type ConsumptionCreatedPayload = {
  id: number;
  external_id: string;
  table_session_id: number;
  order_id: number | null;
  product_id: number | null;
  type: string;
  description: string;
  quantity: number;
  unit_amount: number;
  amount: number;
  reverses_id: number | null;
  reason: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

/**
 * Convierte una fila `Consumption` recién creada por Prisma en el
 * payload que el outbox espera. Usado por todos los productores de
 * `consumption.created` para evitar inconsistencias de shape entre
 * call sites.
 */
export function serializeConsumptionForOutbox(
  consumption: Consumption,
): ConsumptionCreatedPayload {
  return {
    id: consumption.id,
    external_id: consumption.external_id,
    table_session_id: consumption.table_session_id,
    order_id: consumption.order_id,
    product_id: consumption.product_id,
    type: consumption.type,
    description: consumption.description,
    quantity: consumption.quantity,
    unit_amount: toNumber(consumption.unit_amount),
    amount: toNumber(consumption.amount),
    reverses_id: consumption.reverses_id,
    reason: consumption.reason,
    notes: consumption.notes,
    created_by: consumption.created_by,
    created_at: consumption.created_at.toISOString(),
  };
}

/**
 * Castea Decimal de Prisma a number. Si recibe `Decimal` instance,
 * usa `Number()`. Si ya es number (algunos call sites lo pasan así),
 * lo devuelve tal cual.
 */
function toNumber(value: Prisma.Decimal | number): number {
  return typeof value === "number" ? value : Number(value);
}
