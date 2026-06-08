/**
 * Tipos compartidos del OutboxEventService.
 *
 * Ver ARQUITECTURA.md §4 (Transactional Outbox) y §4.1 (Idempotencia).
 *
 * El input al enqueue es deliberadamente mínimo: el caller solo declara
 * qué pasó y a qué entidad, el service rellena `node_id`, versiones e
 * `idempotency_key` desde su config + UUID generado.
 */

/**
 * Input mínimo para encolar un evento.
 *
 * `payload` se valida contra el schema registrado para `event_type`
 * (ver `outbox-event-registry.ts`). Si no hay schema registrado, el
 * service rechaza el enqueue — política conservadora para evitar
 * payloads sin estructura llegando al cloud.
 */
export type EnqueueOutboxEventInput = {
  /**
   * Identificador del evento. Convención: `<aggregate>.<verb>` en
   * minúsculas, ej. "session.opened", "consumption.created",
   * "order.delivered". El registry valida que esté declarado.
   */
  event_type: string;
  /**
   * Tabla de la entidad afectada, en PascalCase Prisma, ej.
   * "TableSession", "Consumption", "OrderItemComponent".
   */
  aggregate_type: string;
  /**
   * external_id (UUID) de la entidad. NO el PK interno Int — el sync
   * deduplica por este valor cross-nodo.
   */
  aggregate_id: string;
  /**
   * Snapshot completo de la entidad al momento del evento. Se serializa
   * como JSON. NO incluir secretos (password_hash, tokens) — se hace
   * sanitización mínima al guardar.
   */
  payload: unknown;
};

/**
 * Resultado del enqueue. Devuelve el ID y la idempotency_key generados
 * para que el caller pueda loggear o tracear si necesita.
 */
export type EnqueueOutboxEventResult = {
  id: bigint;
  idempotency_key: string;
};
