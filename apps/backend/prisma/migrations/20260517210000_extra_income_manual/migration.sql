-- Agrega soporte para ingresos extra manuales (concepto + monto libres).
--   1. Nuevo valor 'manual' en el enum ExtraIncomeType.
--   2. Nueva columna `concept` nullable para descripcion del ingreso.
--      Nullable porque los tipos existentes (restroom) no la usan.
--
-- Safe: no toca filas existentes (ningún ExtraIncome cambia), no agrega
-- constraints adicionales sobre datos antiguos.

ALTER TYPE "ExtraIncomeType" ADD VALUE 'manual';

ALTER TABLE "ExtraIncome"
  ADD COLUMN "concept" TEXT;
