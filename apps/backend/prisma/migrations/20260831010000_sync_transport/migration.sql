-- MVP 2 — transporte de sync (Fase 1):
--   1) OutboxEvent.next_attempt_at — backoff del worker de drain.
--   2) InboxEvent — zona de aterrizaje durable del lado receptor
--      (cloud) con dedup por (node_id, idempotency_key). Ver §4.1 de
--      ARQUITECTURA.md.
--
-- Idempotente: seguro de correr N veces.

-- 1) Backoff del worker.
ALTER TABLE "OutboxEvent"
  ADD COLUMN IF NOT EXISTS "next_attempt_at" TIMESTAMP(3);

-- 2) Enum de estado del inbox.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InboxStatus') THEN
    CREATE TYPE "InboxStatus" AS ENUM ('received', 'applied', 'quarantined');
  END IF;
END$$;

-- 3) Tabla InboxEvent.
CREATE TABLE IF NOT EXISTS "InboxEvent" (
  "id"              BIGSERIAL PRIMARY KEY,
  "node_id"         TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "event_type"      TEXT NOT NULL,
  "aggregate_type"  TEXT NOT NULL,
  "aggregate_id"    TEXT NOT NULL,
  "payload"         JSONB NOT NULL,
  "schema_version"  TEXT NOT NULL,
  "app_version"     TEXT NOT NULL,
  "occurred_at"     TIMESTAMP(3) NOT NULL,
  "received_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status"          "InboxStatus" NOT NULL DEFAULT 'received',
  "applied_at"      TIMESTAMP(3),
  "apply_attempts"  INTEGER NOT NULL DEFAULT 0,
  "last_error"      TEXT
);

-- 4) UNIQUE de idempotencia (la pieza que hace seguro el reintento).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'InboxEvent_node_id_idempotency_key_key'
  ) THEN
    CREATE UNIQUE INDEX "InboxEvent_node_id_idempotency_key_key"
      ON "InboxEvent" ("node_id", "idempotency_key");
  END IF;
END$$;

-- 5) Índices de consulta.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'InboxEvent_status_occurred_at_idx'
  ) THEN
    CREATE INDEX "InboxEvent_status_occurred_at_idx"
      ON "InboxEvent" ("status", "occurred_at");
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'InboxEvent_aggregate_type_aggregate_id_idx'
  ) THEN
    CREATE INDEX "InboxEvent_aggregate_type_aggregate_id_idx"
      ON "InboxEvent" ("aggregate_type", "aggregate_id");
  END IF;
END$$;
