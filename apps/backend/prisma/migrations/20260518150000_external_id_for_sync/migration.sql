-- ==========================================================================
-- Migration: external_id (UUID) en entidades operativas para sync cross-nodo
-- ==========================================================================
--
-- Ver ARQUITECTURA.md §3 para el racional completo. Resumen:
--
--   Mantener `id Int autoincrement` como PK interno para no romper FKs ni
--   queries existentes. Agregar `external_id String UNIQUE` con UUID v4
--   estable cross-nodo (cada local y cloud generan los suyos al crear
--   filas; la llave de deduplicación al sincronizar es (source_node_id,
--   external_id)).
--
-- Estrategia de migration:
--   1. Habilitar pgcrypto si no está (para gen_random_uuid()).
--   2. Por cada entidad operativa:
--      a) ADD COLUMN external_id TEXT (nullable por ahora).
--      b) BACKFILL: filas existentes obtienen un UUID retroactivo.
--      c) SET NOT NULL.
--      d) CREATE UNIQUE INDEX.
--
-- Safe: solo agrega columnas/índices, no toca data existente más allá
-- del backfill. Reversible (DROP COLUMN + DROP INDEX).
--
-- Tiempo estimado: <30s para BDs de tamaño Crown Bar (10k filas).
-- Para BDs grandes, los backfills se pueden hacer en chunks pero no
-- aplica acá.

-- ─── Habilitar pgcrypto para gen_random_uuid() ────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Helper macro mental ──────────────────────────────────────────────────
-- Para cada tabla:
--   ALTER TABLE "X" ADD COLUMN "external_id" TEXT;
--   UPDATE "X" SET "external_id" = gen_random_uuid()::TEXT WHERE "external_id" IS NULL;
--   ALTER TABLE "X" ALTER COLUMN "external_id" SET NOT NULL;
--   CREATE UNIQUE INDEX "X_external_id_key" ON "X"("external_id");

-- ─── TableSession ─────────────────────────────────────────────────────────
ALTER TABLE "TableSession" ADD COLUMN "external_id" TEXT;
UPDATE "TableSession" SET "external_id" = gen_random_uuid()::TEXT WHERE "external_id" IS NULL;
ALTER TABLE "TableSession" ALTER COLUMN "external_id" SET NOT NULL;
CREATE UNIQUE INDEX "TableSession_external_id_key" ON "TableSession"("external_id");

-- ─── Song ─────────────────────────────────────────────────────────────────
ALTER TABLE "Song" ADD COLUMN "external_id" TEXT;
UPDATE "Song" SET "external_id" = gen_random_uuid()::TEXT WHERE "external_id" IS NULL;
ALTER TABLE "Song" ALTER COLUMN "external_id" SET NOT NULL;
CREATE UNIQUE INDEX "Song_external_id_key" ON "Song"("external_id");

-- ─── QueueItem ────────────────────────────────────────────────────────────
ALTER TABLE "QueueItem" ADD COLUMN "external_id" TEXT;
UPDATE "QueueItem" SET "external_id" = gen_random_uuid()::TEXT WHERE "external_id" IS NULL;
ALTER TABLE "QueueItem" ALTER COLUMN "external_id" SET NOT NULL;
CREATE UNIQUE INDEX "QueueItem_external_id_key" ON "QueueItem"("external_id");

-- ─── OrderItemComponent ───────────────────────────────────────────────────
ALTER TABLE "OrderItemComponent" ADD COLUMN "external_id" TEXT;
UPDATE "OrderItemComponent" SET "external_id" = gen_random_uuid()::TEXT WHERE "external_id" IS NULL;
ALTER TABLE "OrderItemComponent" ALTER COLUMN "external_id" SET NOT NULL;
CREATE UNIQUE INDEX "OrderItemComponent_external_id_key" ON "OrderItemComponent"("external_id");

-- ─── InventoryMovement ────────────────────────────────────────────────────
ALTER TABLE "InventoryMovement" ADD COLUMN "external_id" TEXT;
UPDATE "InventoryMovement" SET "external_id" = gen_random_uuid()::TEXT WHERE "external_id" IS NULL;
ALTER TABLE "InventoryMovement" ALTER COLUMN "external_id" SET NOT NULL;
CREATE UNIQUE INDEX "InventoryMovement_external_id_key" ON "InventoryMovement"("external_id");

-- ─── OrderRequest ─────────────────────────────────────────────────────────
ALTER TABLE "OrderRequest" ADD COLUMN "external_id" TEXT;
UPDATE "OrderRequest" SET "external_id" = gen_random_uuid()::TEXT WHERE "external_id" IS NULL;
ALTER TABLE "OrderRequest" ALTER COLUMN "external_id" SET NOT NULL;
CREATE UNIQUE INDEX "OrderRequest_external_id_key" ON "OrderRequest"("external_id");

-- ─── Order ────────────────────────────────────────────────────────────────
ALTER TABLE "Order" ADD COLUMN "external_id" TEXT;
UPDATE "Order" SET "external_id" = gen_random_uuid()::TEXT WHERE "external_id" IS NULL;
ALTER TABLE "Order" ALTER COLUMN "external_id" SET NOT NULL;
CREATE UNIQUE INDEX "Order_external_id_key" ON "Order"("external_id");

-- ─── OrderItem ────────────────────────────────────────────────────────────
ALTER TABLE "OrderItem" ADD COLUMN "external_id" TEXT;
UPDATE "OrderItem" SET "external_id" = gen_random_uuid()::TEXT WHERE "external_id" IS NULL;
ALTER TABLE "OrderItem" ALTER COLUMN "external_id" SET NOT NULL;
CREATE UNIQUE INDEX "OrderItem_external_id_key" ON "OrderItem"("external_id");

-- ─── Consumption ──────────────────────────────────────────────────────────
ALTER TABLE "Consumption" ADD COLUMN "external_id" TEXT;
UPDATE "Consumption" SET "external_id" = gen_random_uuid()::TEXT WHERE "external_id" IS NULL;
ALTER TABLE "Consumption" ALTER COLUMN "external_id" SET NOT NULL;
CREATE UNIQUE INDEX "Consumption_external_id_key" ON "Consumption"("external_id");

-- ─── AuditLog ─────────────────────────────────────────────────────────────
ALTER TABLE "AuditLog" ADD COLUMN "external_id" TEXT;
UPDATE "AuditLog" SET "external_id" = gen_random_uuid()::TEXT WHERE "external_id" IS NULL;
ALTER TABLE "AuditLog" ALTER COLUMN "external_id" SET NOT NULL;
CREATE UNIQUE INDEX "AuditLog_external_id_key" ON "AuditLog"("external_id");

-- ─── ExtraIncome ──────────────────────────────────────────────────────────
ALTER TABLE "ExtraIncome" ADD COLUMN "external_id" TEXT;
UPDATE "ExtraIncome" SET "external_id" = gen_random_uuid()::TEXT WHERE "external_id" IS NULL;
ALTER TABLE "ExtraIncome" ALTER COLUMN "external_id" SET NOT NULL;
CREATE UNIQUE INDEX "ExtraIncome_external_id_key" ON "ExtraIncome"("external_id");

-- ─── LuggageTicket ────────────────────────────────────────────────────────
ALTER TABLE "LuggageTicket" ADD COLUMN "external_id" TEXT;
UPDATE "LuggageTicket" SET "external_id" = gen_random_uuid()::TEXT WHERE "external_id" IS NULL;
ALTER TABLE "LuggageTicket" ALTER COLUMN "external_id" SET NOT NULL;
CREATE UNIQUE INDEX "LuggageTicket_external_id_key" ON "LuggageTicket"("external_id");
