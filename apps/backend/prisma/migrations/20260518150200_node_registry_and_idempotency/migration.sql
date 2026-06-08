-- ==========================================================================
-- Migration: NodeRegistry + idempotency_key en OutboxEvent
-- ==========================================================================
--
-- Ver ARQUITECTURA.md §3.5 (NodeRegistry) y §4.1 (idempotency).
--
-- A) NodeRegistry: catálogo formal de nodos del sistema (cloud + cada
--    local). PK es node_id mismo (string), permite heartbeat,
--    versionado y pool de fichas Luggage por nodo.
--
-- B) OutboxEvent.idempotency_key: UUID único por evento. Cierra el
--    hueco de reintentos cuando el ACK del push se pierde. El cloud
--    deduplica con UNIQUE (node_id, idempotency_key).
--
-- Safe: agrega columnas con default + tabla nueva. Backfill del campo
-- nuevo con gen_random_uuid() para filas existentes (en este momento
-- la tabla OutboxEvent está vacía, pero por defensa hacemos el backfill
-- igual).

-- ─── NodeRegistry ─────────────────────────────────────────────────────────

CREATE TYPE "NodeType" AS ENUM ('cloud', 'local');

CREATE TABLE "NodeRegistry" (
  "node_id"                   TEXT         PRIMARY KEY,
  "name"                      TEXT         NOT NULL,
  "type"                      "NodeType"   NOT NULL,
  "installed_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at"              TIMESTAMP(3),
  "app_version"               TEXT,
  "schema_version"            TEXT,
  "is_active"                 BOOLEAN      NOT NULL DEFAULT true,
  "luggage_ticket_pool_start" INTEGER,
  "luggage_ticket_pool_end"   INTEGER,
  "notes"                     TEXT,
  "created_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                TIMESTAMP(3) NOT NULL
);

CREATE INDEX "NodeRegistry_type_is_active_idx"
  ON "NodeRegistry" ("type", "is_active");

-- Seed mínimo: el nodo cloud siempre existe con su pool de fichas
-- 1-99999 (asunción de ARQUITECTURA.md §8). Los locales se registran
-- cuando se aprovisionan.
INSERT INTO "NodeRegistry" (
  "node_id", "name", "type", "is_active",
  "luggage_ticket_pool_start", "luggage_ticket_pool_end",
  "updated_at"
) VALUES (
  'cloud', 'Cloud Railway', 'cloud', true,
  1, 99999,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("node_id") DO NOTHING;

-- ─── OutboxEvent.idempotency_key ──────────────────────────────────────────

ALTER TABLE "OutboxEvent"
  ADD COLUMN "idempotency_key" TEXT;

-- Backfill defensivo. La tabla está vacía en esta fase pero por si
-- alguna fila entró durante el rollout.
UPDATE "OutboxEvent"
  SET "idempotency_key" = gen_random_uuid()::TEXT
  WHERE "idempotency_key" IS NULL;

ALTER TABLE "OutboxEvent"
  ALTER COLUMN "idempotency_key" SET NOT NULL;

-- Deduplicación: dos eventos con misma (node_id, idempotency_key) son
-- el mismo evento reintentado — el segundo INSERT colisiona y se
-- trata como "ya procesado".
CREATE UNIQUE INDEX "OutboxEvent_node_id_idempotency_key_key"
  ON "OutboxEvent" ("node_id", "idempotency_key");
