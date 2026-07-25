-- Método de pago en ingresos extra (baños, manuales).
--
-- Antes se asumían SIEMPRE en efectivo — supuesto invalidado por la
-- operación real (hubo cobros rápidos pagados por Bold). Ahora cada
-- ExtraIncome registra su método; la UI ofrece Efectivo / Bold (Bold
-- se persiste como qr_bold, misma convención que Expense).
--
-- Las filas históricas quedan en 'efectivo' (default) — coherente con
-- el supuesto vigente cuando se crearon. Idempotente.

ALTER TABLE "ExtraIncome"
  ADD COLUMN IF NOT EXISTS "method" "PaymentMethod" NOT NULL DEFAULT 'efectivo';
