-- Asignación de pagos parciales a líneas de producto ("cada quien
-- paga lo suyo"). Un pago parcial puede declarar qué líneas de la
-- cuenta cubre y cuántas unidades de cada una; sin asignaciones sigue
-- siendo un monto libre.
--
-- Regla de vida: una asignación cuenta solo mientras su
-- payment_consumption (Consumption type=partial_payment) no esté
-- reversado. Nunca se borra — reversar el pago la "apaga" sola.
--
-- Idempotente: seguro de correr N veces.

-- 1) Tabla.
CREATE TABLE IF NOT EXISTS "PartialPaymentAllocation" (
  "id"                     SERIAL PRIMARY KEY,
  "external_id"            TEXT NOT NULL,
  "payment_consumption_id" INTEGER NOT NULL,
  "product_consumption_id" INTEGER NOT NULL,
  "quantity"               INTEGER NOT NULL,
  "amount"                 DECIMAL(10, 2) NOT NULL,
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2) UNIQUE external_id (sync cross-nodo).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'PartialPaymentAllocation_external_id_key'
  ) THEN
    CREATE UNIQUE INDEX "PartialPaymentAllocation_external_id_key"
      ON "PartialPaymentAllocation" ("external_id");
  END IF;
END$$;

-- 3) Índices de consulta (agregado de pagado por línea y lookup por pago).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'PartialPaymentAllocation_payment_consumption_id_idx'
  ) THEN
    CREATE INDEX "PartialPaymentAllocation_payment_consumption_id_idx"
      ON "PartialPaymentAllocation" ("payment_consumption_id");
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'PartialPaymentAllocation_product_consumption_id_idx'
  ) THEN
    CREATE INDEX "PartialPaymentAllocation_product_consumption_id_idx"
      ON "PartialPaymentAllocation" ("product_consumption_id");
  END IF;
END$$;

-- 4) Foreign keys → Consumption (CASCADE: si la sesión entera se borra
--    en cascada, las asignaciones caen con sus Consumption).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'PartialPaymentAllocation_payment_consumption_id_fkey'
      AND table_name = 'PartialPaymentAllocation'
  ) THEN
    ALTER TABLE "PartialPaymentAllocation"
      ADD CONSTRAINT "PartialPaymentAllocation_payment_consumption_id_fkey"
      FOREIGN KEY ("payment_consumption_id")
      REFERENCES "Consumption"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'PartialPaymentAllocation_product_consumption_id_fkey'
      AND table_name = 'PartialPaymentAllocation'
  ) THEN
    ALTER TABLE "PartialPaymentAllocation"
      ADD CONSTRAINT "PartialPaymentAllocation_product_consumption_id_fkey"
      FOREIGN KEY ("product_consumption_id")
      REFERENCES "Consumption"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;
