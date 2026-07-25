-- Método de pago del guardarropa. Default 'efectivo' para las filas
-- históricas (todas se cobraron en efectivo); la UI siempre lo manda
-- explícito de aquí en adelante. Idempotente por seguridad de deploy.
ALTER TABLE "LuggageTicket"
  ADD COLUMN IF NOT EXISTS "method" "PaymentMethod" NOT NULL DEFAULT 'efectivo';
