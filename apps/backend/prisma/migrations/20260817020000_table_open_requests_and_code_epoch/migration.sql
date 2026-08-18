-- Sesiones QR seguras (F3):
--   1) BarAccessCode.epoch — generación de revocación de sesiones de
--      cliente. Solo la rotación MANUAL lo incrementa; la automática de
--      24h lo conserva (una sesión viva solo muere por cierre de mesa o
--      cambio manual del código).
--   2) TableOpenRequest — solicitudes de apertura de mesa cerrada vía
--      QR, aprobadas/rechazadas por el admin. El session_token se
--      entrega por claim HTTP de un solo uso, nunca por socket.
--   3) AuditEventKind nuevos.
--
-- Idempotente: seguro de correr N veces.

-- 1) Epoch del código.
ALTER TABLE "BarAccessCode"
  ADD COLUMN IF NOT EXISTS "epoch" INTEGER NOT NULL DEFAULT 0;

-- 2) Enum de estado de solicitud.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TableOpenRequestStatus') THEN
    CREATE TYPE "TableOpenRequestStatus" AS ENUM (
      'pending',
      'approved',
      'rejected',
      'expired',
      'cancelled'
    );
  END IF;
END$$;

-- 3) Tabla de solicitudes.
CREATE TABLE IF NOT EXISTS "TableOpenRequest" (
  "id"          SERIAL PRIMARY KEY,
  "external_id" TEXT NOT NULL,
  "table_id"    INTEGER NOT NULL,
  "status"      "TableOpenRequestStatus" NOT NULL DEFAULT 'pending',
  "claim_token" TEXT NOT NULL,
  "session_id"  INTEGER,
  "resolved_by" TEXT,
  "expires_at"  TIMESTAMP(3) NOT NULL,
  "claimed_at"  TIMESTAMP(3),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3)
);

-- 4) UNIQUEs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'TableOpenRequest_external_id_key'
  ) THEN
    CREATE UNIQUE INDEX "TableOpenRequest_external_id_key"
      ON "TableOpenRequest" ("external_id");
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'TableOpenRequest_claim_token_key'
  ) THEN
    CREATE UNIQUE INDEX "TableOpenRequest_claim_token_key"
      ON "TableOpenRequest" ("claim_token");
  END IF;
END$$;

-- 5) Índices de consulta.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'TableOpenRequest_table_id_status_idx'
  ) THEN
    CREATE INDEX "TableOpenRequest_table_id_status_idx"
      ON "TableOpenRequest" ("table_id", "status");
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'TableOpenRequest_status_expires_at_idx'
  ) THEN
    CREATE INDEX "TableOpenRequest_status_expires_at_idx"
      ON "TableOpenRequest" ("status", "expires_at");
  END IF;
END$$;

-- 6) FK → Table.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'TableOpenRequest_table_id_fkey'
      AND table_name = 'TableOpenRequest'
  ) THEN
    ALTER TABLE "TableOpenRequest"
      ADD CONSTRAINT "TableOpenRequest_table_id_fkey"
      FOREIGN KEY ("table_id") REFERENCES "Table"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

-- 7) AuditEventKind nuevos.
ALTER TYPE "AuditEventKind" ADD VALUE IF NOT EXISTS 'table_open_requested';
ALTER TYPE "AuditEventKind" ADD VALUE IF NOT EXISTS 'session_open_approved';
ALTER TYPE "AuditEventKind" ADD VALUE IF NOT EXISTS 'session_open_rejected';
