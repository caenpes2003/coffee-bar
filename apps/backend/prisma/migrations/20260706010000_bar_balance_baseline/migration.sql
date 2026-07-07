-- Saldo del bar — línea base editable con auditoría append-only.
--
-- El saldo mostrado se DERIVA (nunca se persiste):
--   efectivo = baseline.cash + SUM(declared - opening) de las
--              CashRegisterSession cerradas después de set_at
--   bold     = baseline.bold + SUM(cobros Bold - egresos Bold) de
--              esas mismas sesiones
--
-- Append-only: cada corrección inserta una fila nueva; la más
-- reciente es la línea base activa.

CREATE TABLE IF NOT EXISTS "BarBalanceBaseline" (
  "id"           SERIAL PRIMARY KEY,
  "external_id"  TEXT NOT NULL,
  "cash_amount"  DECIMAL(14, 2) NOT NULL,
  "bold_amount"  DECIMAL(14, 2) NOT NULL,
  "set_by"       TEXT,
  "note"         TEXT,
  "set_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'BarBalanceBaseline_external_id_key'
  ) THEN
    CREATE UNIQUE INDEX "BarBalanceBaseline_external_id_key"
      ON "BarBalanceBaseline" ("external_id");
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'BarBalanceBaseline_set_at_idx'
  ) THEN
    CREATE INDEX "BarBalanceBaseline_set_at_idx"
      ON "BarBalanceBaseline" ("set_at");
  END IF;
END$$;
