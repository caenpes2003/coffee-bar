-- Fase A+ B2 hotfix: reverso de Payment.
--
-- Cierra el hueco operativo donde un cobro registrado tiene que
-- deshacerse (Bold rechaza tarjeta post-cierre, doble cobro, mesa
-- equivocada, devolución por cortesía, prueba operativa). Sin esto,
-- el cálculo de `expected` del cierre de día incluye el Payment
-- fantasma y produce descuadre falso.
--
-- Diseño:
--  - Append-only: el Payment original NUNCA se borra ni se modifica.
--    Una fila kind='reversal' con amount opuesto neutraliza el efecto
--    a nivel SUM y el original queda para audit.
--  - reverses_id es self-FK UNIQUE: solo se permite UN reverso por
--    Payment (evita reversos en cadena que enmascararían errores).
--  - reverse_reason enum cerrado para reportería; reverse_reason_detail
--    string libre para 'other'.

-- 1) Nuevo valor en PaymentKind.
ALTER TYPE "PaymentKind" ADD VALUE IF NOT EXISTS 'reversal';

-- 1b) Nuevo valor en AuditEventKind (para auditar el reverso).
ALTER TYPE "AuditEventKind" ADD VALUE IF NOT EXISTS 'payment_reversed';

-- 2) Enum nuevo para la razón.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentReverseReason') THEN
    CREATE TYPE "PaymentReverseReason" AS ENUM (
      'bold_rejected',
      'wrong_session',
      'double_charge',
      'customer_refund',
      'test_operation',
      'staff_error',
      'other'
    );
  END IF;
END$$;

-- 3) Columnas nuevas en Payment.
ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "reverses_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "reverse_reason" "PaymentReverseReason",
  ADD COLUMN IF NOT EXISTS "reverse_reason_detail" TEXT;

-- 4) UNIQUE sobre reverses_id (un Payment solo puede ser reversado UNA vez).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'Payment_reverses_id_key'
  ) THEN
    CREATE UNIQUE INDEX "Payment_reverses_id_key" ON "Payment" ("reverses_id");
  END IF;
END$$;

-- 5) FK self-referencial. ON DELETE RESTRICT: el original no puede
--    borrarse si tiene un reverso colgado (defensa contra mutaciones
--    accidentales en BD que romperían la trazabilidad).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Payment_reverses_id_fkey'
      AND table_name = 'Payment'
  ) THEN
    ALTER TABLE "Payment"
      ADD CONSTRAINT "Payment_reverses_id_fkey"
      FOREIGN KEY ("reverses_id") REFERENCES "Payment"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END$$;
