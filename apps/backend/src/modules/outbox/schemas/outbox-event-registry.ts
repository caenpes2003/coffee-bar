/**
 * Registro de schemas de eventos del outbox.
 *
 * Cada event_type registrado declara su shape esperado de payload. Al
 * encolarse, el OutboxEventService valida el payload contra el schema.
 * Si event_type no está registrado, el enqueue se rechaza con
 * `OUTBOX_UNKNOWN_EVENT_TYPE` — política conservadora.
 *
 * Por qué un registro propio y no class-validator clases:
 *   - Los productores pasan objetos plain (snapshots de Prisma), no
 *     instancias de clase. Forzar a hidratar instancias agrega ceremonia
 *     sin valor.
 *   - El validador es una función pura `(payload) => string[]`
 *     (devuelve errores; vacío = OK). Fácil de testear y extender.
 *   - Cuando llegue el endpoint cloud /sync/ingest, este mismo registry
 *     puede compartirse para validar payloads recibidos.
 *
 * Convención de nombres:
 *   `<aggregate>.<verb>` en minúsculas snake_case del aggregate +
 *   verbo en past simple. Ejemplos: "session.opened", "consumption.created",
 *   "order.delivered", "inventory.recorded".
 *
 * Esta primera versión declara los 4 eventos prioritarios del roadmap.
 * Cada vez que un service productor empiece a emitir un event_type
 * nuevo, debe agregarse acá ANTES de hacer el enqueue.
 */

/**
 * Resultado de validar un payload: lista de mensajes de error. Vacío
 * = OK. Devolver siempre array (no exception) facilita acumular
 * múltiples errores en un solo paso.
 */
export type PayloadValidator = (payload: unknown) => string[];

/**
 * Helper: chequea que un valor es un objeto plain (no array, no null).
 */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Helper: chequea que un campo string esté presente y no vacío.
 */
function requireString(
  payload: Record<string, unknown>,
  field: string,
  errors: string[],
): void {
  const v = payload[field];
  if (typeof v !== "string" || v.trim().length === 0) {
    errors.push(`${field} must be a non-empty string`);
  }
}

/**
 * Helper: chequea que un campo numérico esté presente y finito.
 */
function requireNumber(
  payload: Record<string, unknown>,
  field: string,
  errors: string[],
): void {
  const v = payload[field];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    errors.push(`${field} must be a finite number`);
  }
}

/**
 * Helper: chequea que un campo UUID externo esté presente. Usa la regex
 * estándar de UUID v4 (mismo formato que generan @default(uuid()) de
 * Prisma).
 */
function requireExternalId(
  payload: Record<string, unknown>,
  field: string,
  errors: string[],
): void {
  const v = payload[field];
  if (typeof v !== "string") {
    errors.push(`${field} must be a UUID string`);
    return;
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    errors.push(`${field} is not a valid UUID`);
  }
}

// ─── Registro ────────────────────────────────────────────────────────────

export const OUTBOX_EVENT_REGISTRY: Record<string, PayloadValidator> = {
  // ─── Consumption ─────────────────────────────────────────────────────
  // Toda fila nueva del ledger (productos, ajustes, descuentos, refunds,
  // partial_payments). Inmutable: jamás se emite un consumption.updated.
  // Refunds se emiten como un consumption.created nuevo con reverses_id.
  "consumption.created": (payload) => {
    const errors: string[] = [];
    if (!isObject(payload)) {
      return ["payload must be an object"];
    }
    requireExternalId(payload, "external_id", errors);
    requireNumber(payload, "table_session_id", errors);
    requireString(payload, "type", errors);
    requireString(payload, "description", errors);
    requireNumber(payload, "amount", errors);
    return errors;
  },

  // ─── TableSession ────────────────────────────────────────────────────
  // session.opened: apertura inicial. payload es la TableSession recién
  // creada.
  "session.opened": (payload) => {
    const errors: string[] = [];
    if (!isObject(payload)) return ["payload must be an object"];
    requireExternalId(payload, "external_id", errors);
    requireNumber(payload, "table_id", errors);
    requireString(payload, "status", errors);
    return errors;
  },

  // session.marked_paid: admin registró el cobro. Total final como
  // métrica clave en el payload.
  "session.marked_paid": (payload) => {
    const errors: string[] = [];
    if (!isObject(payload)) return ["payload must be an object"];
    requireExternalId(payload, "external_id", errors);
    requireNumber(payload, "total_consumption", errors);
    return errors;
  },

  // session.closed: cierre definitivo. payload incluye snapshot final.
  "session.closed": (payload) => {
    const errors: string[] = [];
    if (!isObject(payload)) return ["payload must be an object"];
    requireExternalId(payload, "external_id", errors);
    requireString(payload, "status", errors);
    return errors;
  },

  // session.voided: anulación SIN cobro. Razón obligatoria.
  "session.voided": (payload) => {
    const errors: string[] = [];
    if (!isObject(payload)) return ["payload must be an object"];
    requireExternalId(payload, "external_id", errors);
    requireString(payload, "void_reason", errors);
    return errors;
  },

  // ─── Order ───────────────────────────────────────────────────────────
  // order.status_changed: una sola event_type para todas las
  // transiciones (accepted → preparing → ready → delivered → cancelled).
  // El payload trae from + to para que el consumer decida side effects.
  "order.status_changed": (payload) => {
    const errors: string[] = [];
    if (!isObject(payload)) return ["payload must be an object"];
    requireExternalId(payload, "external_id", errors);
    requireString(payload, "from_status", errors);
    requireString(payload, "to_status", errors);
    return errors;
  },

  // ─── InventoryMovement ───────────────────────────────────────────────
  // Toda fila nueva: restock, adjustment, waste, correction.
  "inventory.recorded": (payload) => {
    const errors: string[] = [];
    if (!isObject(payload)) return ["payload must be an object"];
    requireExternalId(payload, "external_id", errors);
    requireNumber(payload, "product_id", errors);
    requireString(payload, "type", errors);
    requireNumber(payload, "quantity", errors);
    return errors;
  },

  // ─── Payment (Fase A+) ───────────────────────────────────────────────
  // Cada cobro del bar con método. kind=partial (anticipo durante sesión)
  // o kind=final (cobro al cierre, puede haber N por TableSession en
  // caso de cobros divididos).
  "payment.created": (payload) => {
    const errors: string[] = [];
    if (!isObject(payload)) return ["payload must be an object"];
    requireExternalId(payload, "external_id", errors);
    requireNumber(payload, "table_session_id", errors);
    requireNumber(payload, "cash_register_session_id", errors);
    requireString(payload, "method", errors);
    requireString(payload, "kind", errors);
    requireNumber(payload, "amount", errors);
    return errors;
  },

  // payment.reversed: anulación append-only. La fila tiene
  // kind='reversal', amount con signo opuesto al original, y
  // reverses_external_id apuntando al Payment anulado. El consumer
  // cloud netea automáticamente sumando amount; este event_type
  // permite además reportar "cuántos reverses y por qué razón".
  "payment.reversed": (payload) => {
    const errors: string[] = [];
    if (!isObject(payload)) return ["payload must be an object"];
    requireExternalId(payload, "external_id", errors);
    requireExternalId(payload, "reverses_external_id", errors);
    requireNumber(payload, "table_session_id", errors);
    requireNumber(payload, "cash_register_session_id", errors);
    requireString(payload, "method", errors);
    requireNumber(payload, "amount", errors);
    requireString(payload, "reverse_reason", errors);
    return errors;
  },

  // ─── CashRegisterSession (Fase A+) ───────────────────────────────────
  // cash_register.opened: apertura del día contable con base declarada
  // (o bypass si se abrió en modo emergencia).
  "cash_register.opened": (payload) => {
    const errors: string[] = [];
    if (!isObject(payload)) return ["payload must be an object"];
    requireExternalId(payload, "external_id", errors);
    requireNumber(payload, "opening_balance", errors);
    requireString(payload, "status", errors);
    return errors;
  },

  // cash_register.closed: cierre del día con declared/expected/difference.
  // El consumer cloud calcula descuadre histórico desde estos eventos.
  "cash_register.closed": (payload) => {
    const errors: string[] = [];
    if (!isObject(payload)) return ["payload must be an object"];
    requireExternalId(payload, "external_id", errors);
    requireString(payload, "status", errors);
    requireNumber(payload, "closing_balance_declared", errors);
    requireNumber(payload, "closing_balance_expected", errors);
    requireNumber(payload, "difference", errors);
    return errors;
  },

  // ─── Expense (Fase A+ — Gastos v1) ───────────────────────────────────
  // Egreso de caja: reposición de productos, insumos, servicios, etc.
  // Resta del expected del cierre de jornada según el método.
  "expense.created": (payload) => {
    const errors: string[] = [];
    if (!isObject(payload)) return ["payload must be an object"];
    requireExternalId(payload, "external_id", errors);
    requireNumber(payload, "cash_register_session_id", errors);
    requireString(payload, "method", errors);
    requireString(payload, "category", errors);
    requireNumber(payload, "amount", errors);
    requireString(payload, "concept", errors);
    return errors;
  },

  // expense.reversed: anulación append-only de un Expense previo. La
  // fila tiene kind='reversal', amount con signo opuesto al original y
  // reverses_external_id apuntando al Expense anulado.
  "expense.reversed": (payload) => {
    const errors: string[] = [];
    if (!isObject(payload)) return ["payload must be an object"];
    requireExternalId(payload, "external_id", errors);
    requireExternalId(payload, "reverses_external_id", errors);
    requireNumber(payload, "cash_register_session_id", errors);
    requireString(payload, "method", errors);
    requireNumber(payload, "amount", errors);
    requireString(payload, "reverse_reason", errors);
    return errors;
  },
};

/**
 * Validar un payload contra el schema registrado para el event_type.
 * Devuelve errores; vacío = OK.
 *
 * Si el event_type no está registrado, devuelve un error indicándolo —
 * el caller debe registrar el schema antes de emitir.
 */
export function validatePayload(
  event_type: string,
  payload: unknown,
): string[] {
  const validator = OUTBOX_EVENT_REGISTRY[event_type];
  if (!validator) {
    return [
      `event_type "${event_type}" is not registered in OUTBOX_EVENT_REGISTRY`,
    ];
  }
  return validator(payload);
}

/**
 * Lista de event_types registrados. Útil para tests, dashboards y para
 * el endpoint cloud /sync/ingest (que debe rechazar event_types
 * desconocidos).
 */
export function listRegisteredEventTypes(): string[] {
  return Object.keys(OUTBOX_EVENT_REGISTRY).sort();
}
