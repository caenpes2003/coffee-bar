-- Fase A+ — Gastos v1.
--
-- Modela egresos de caja durante la operación (reposición de productos
-- al proveedor, insumos, mantenimiento, servicios, etc). Cada Expense
-- reduce el `expected` del cierre de jornada en su método correspondiente:
--   - efectivo      → resta de la caja física esperada
--   - tarjeta_bold  → resta del neto Bold del día
--   - qr_bold       → resta del neto Bold del día
--
-- Append-only: los errores se corrigen creando una fila kind=reversal
-- con amount opuesto. El original nunca se borra.
--
-- Method reusa el enum PaymentMethod ya existente (Fase A+ B2).

-- 1) Enums.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExpenseCategory') THEN
    CREATE TYPE "ExpenseCategory" AS ENUM (
      'mercancia',
      'insumos',
      'mantenimiento',
      'servicios',
      'personal',
      'otros'
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExpenseKind') THEN
    CREATE TYPE "ExpenseKind" AS ENUM ('expense', 'reversal');
  END IF;
END$$;

-- 2) Tabla Expense.
CREATE TABLE IF NOT EXISTS "Expense" (
  "id"                         SERIAL PRIMARY KEY,
  "external_id"                TEXT NOT NULL,
  "cash_register_session_id"   INTEGER NOT NULL,
  "method"                     "PaymentMethod" NOT NULL,
  "category"                   "ExpenseCategory" NOT NULL,
  "kind"                       "ExpenseKind" NOT NULL DEFAULT 'expense',
  "amount"                     DECIMAL(12, 2) NOT NULL,
  "concept"                    TEXT NOT NULL,
  "supplier"                   TEXT,
  "receipt_number"             TEXT,
  "notes"                      TEXT,
  "reverses_id"                INTEGER,
  "reverse_reason"             TEXT,
  "created_by"                 TEXT,
  "created_at"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3) UNIQUE constraints.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'Expense_external_id_key'
  ) THEN
    CREATE UNIQUE INDEX "Expense_external_id_key" ON "Expense" ("external_id");
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'Expense_reverses_id_key'
  ) THEN
    CREATE UNIQUE INDEX "Expense_reverses_id_key" ON "Expense" ("reverses_id");
  END IF;
END$$;

-- 4) Índices de consulta.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'Expense_cash_register_session_id_method_idx'
  ) THEN
    CREATE INDEX "Expense_cash_register_session_id_method_idx"
      ON "Expense" ("cash_register_session_id", "method");
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'Expense_category_created_at_idx'
  ) THEN
    CREATE INDEX "Expense_category_created_at_idx"
      ON "Expense" ("category", "created_at");
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'Expense_created_at_idx'
  ) THEN
    CREATE INDEX "Expense_created_at_idx" ON "Expense" ("created_at");
  END IF;
END$$;

-- 5) Foreign keys.
--    a) cash_register_session_id → CashRegisterSession.id (RESTRICT:
--       no permitimos borrar una sesión de caja que tiene gastos
--       asociados, por integridad histórica).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Expense_cash_register_session_id_fkey'
      AND table_name = 'Expense'
  ) THEN
    ALTER TABLE "Expense"
      ADD CONSTRAINT "Expense_cash_register_session_id_fkey"
      FOREIGN KEY ("cash_register_session_id")
      REFERENCES "CashRegisterSession"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END$$;

--    b) reverses_id → Expense.id (self-FK, RESTRICT: no permitimos
--       borrar un Expense que ya tiene un reverso colgado).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Expense_reverses_id_fkey'
      AND table_name = 'Expense'
  ) THEN
    ALTER TABLE "Expense"
      ADD CONSTRAINT "Expense_reverses_id_fkey"
      FOREIGN KEY ("reverses_id") REFERENCES "Expense"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END$$;
