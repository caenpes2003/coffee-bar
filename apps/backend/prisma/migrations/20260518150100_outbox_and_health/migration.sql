-- ==========================================================================
-- Migration: infraestructura de sync (OutboxEvent + OperationalMode +
-- LocalHealthSnapshot)
-- ==========================================================================
--
-- Ver ARQUITECTURA.md §4 (Outbox), §5 (OperationalMode), §12.5
-- (LocalHealthSnapshot) para el racional.
--
-- Las tres tablas se crean VACÍAS. En esta fase no hay productor ni
-- consumer; sirven como infraestructura preparada para que el worker de
-- sync (fase posterior) y los services no requieran otra migration.
--
-- Safe: solo crea tablas y enums nuevos, no toca nada existente.
-- Reversible (DROP TABLE + DROP TYPE).

-- ─── Enums ────────────────────────────────────────────────────────────────

CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'pushed', 'quarantined');

CREATE TYPE "OperationalModeKind" AS ENUM (
  'CLOUD_NORMAL',
  'LOCAL_PRIMARY',
  'LOCAL_DEGRADED',
  'RECOVERY',
  'EMERGENCY',
  'MAINTENANCE'
);

-- ─── OutboxEvent ──────────────────────────────────────────────────────────

CREATE TABLE "OutboxEvent" (
  "id"             BIGSERIAL PRIMARY KEY,
  "node_id"        TEXT          NOT NULL,
  "event_type"     TEXT          NOT NULL,
  "aggregate_type" TEXT          NOT NULL,
  "aggregate_id"   TEXT          NOT NULL,
  "payload"        JSONB         NOT NULL,
  "schema_version" TEXT          NOT NULL,
  "app_version"    TEXT          NOT NULL,
  "occurred_at"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status"         "OutboxStatus" NOT NULL DEFAULT 'pending',
  "pushed_at"      TIMESTAMP(3),
  "push_attempts"  INTEGER       NOT NULL DEFAULT 0,
  "last_error"     TEXT
);

CREATE INDEX "OutboxEvent_status_occurred_at_idx"
  ON "OutboxEvent" ("status", "occurred_at");
CREATE INDEX "OutboxEvent_aggregate_type_aggregate_id_idx"
  ON "OutboxEvent" ("aggregate_type", "aggregate_id");

-- ─── OperationalMode ──────────────────────────────────────────────────────

CREATE TABLE "OperationalMode" (
  "id"               BIGSERIAL              PRIMARY KEY,
  "node_id"          TEXT                   NOT NULL,
  "mode"             "OperationalModeKind"  NOT NULL,
  "reason"           TEXT,
  "detected_by"      TEXT                   NOT NULL,
  "started_at"       TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at"         TIMESTAMP(3),
  "events_queued"    INTEGER,
  "events_synced"    INTEGER,
  "duration_seconds" INTEGER
);

CREATE INDEX "OperationalMode_node_id_started_at_idx"
  ON "OperationalMode" ("node_id", "started_at");
CREATE INDEX "OperationalMode_mode_ended_at_idx"
  ON "OperationalMode" ("mode", "ended_at");

-- ─── LocalHealthSnapshot ──────────────────────────────────────────────────

CREATE TABLE "LocalHealthSnapshot" (
  "id"                        BIGSERIAL              PRIMARY KEY,
  "node_id"                   TEXT                   NOT NULL,
  "taken_at"                  TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "open_sessions"             INTEGER                NOT NULL,
  "pending_orders"            INTEGER                NOT NULL,
  "active_queue_items"        INTEGER                NOT NULL,
  "pending_outbox_events"     INTEGER                NOT NULL,
  "inventory_movements_today" INTEGER                NOT NULL,
  "consumptions_today"        INTEGER                NOT NULL,
  "total_revenue_today"       DECIMAL(12, 2)         NOT NULL,
  "active_luggage_tickets"    INTEGER                NOT NULL,
  "current_mode"              "OperationalModeKind"  NOT NULL,
  "cloud_reachable"           BOOLEAN                NOT NULL,
  "last_successful_push_at"   TIMESTAMP(3),
  "oldest_pending_event_at"   TIMESTAMP(3)
);

CREATE INDEX "LocalHealthSnapshot_node_id_taken_at_idx"
  ON "LocalHealthSnapshot" ("node_id", "taken_at");
