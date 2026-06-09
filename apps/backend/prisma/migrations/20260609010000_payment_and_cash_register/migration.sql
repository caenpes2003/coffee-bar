-- ==========================================================================
-- Migration: Fase A+ — Payment + CashRegisterSession (cierre de caja)
-- ==========================================================================
--
-- Ver MIGRACION_SYNC.md "Fase A+" y ARQUITECTURA.md §2 (Payment como
-- dominio operativo).
--
-- Resuelve un problema operativo real (descuadre de caja al cierre del
-- día) modelando:
--   1. CashRegisterSession: día contable con apertura/cierre persistido.
--   2. Payment: cada cobro con método (efectivo / tarjeta_bold / qr_bold).
--   3. FK opcional `cash_register_session_id` en Consumption,
--      ExtraIncome y LuggageTicket para agrupar al día contable.
--
-- Mitigaciones de seguridad incluidas:
--   - Auto-día al deploy: se crea automáticamente una CashRegisterSession
--     con opening_balance=0 marcada como bypass para que el sistema tenga
--     continuidad inmediata. El admin la cierra cuando pueda y abre la
--     real con base declarada.
--   - Filas históricas pre-Fase A+ quedan con cash_register_session_id
--     NULL (no se les asigna al auto-día porque viven en días pasados).
--     Los reportes nuevos las muestran como "Sin clasificar" hasta que
--     el operador opte por backfill manual.
--
-- Safe: solo agrega tablas/columnas nullable. Reversible.

-- ─── Enums ────────────────────────────────────────────────────────────────

CREATE TYPE "CashRegisterStatus" AS ENUM ('open', 'closed');
CREATE TYPE "PaymentMethod" AS ENUM ('efectivo', 'tarjeta_bold', 'qr_bold');
CREATE TYPE "PaymentKind" AS ENUM ('partial', 'final');

-- ─── CashRegisterSession ──────────────────────────────────────────────────

CREATE TABLE "CashRegisterSession" (
  "id"                       SERIAL PRIMARY KEY,
  "external_id"              TEXT                 NOT NULL,
  "status"                   "CashRegisterStatus" NOT NULL DEFAULT 'open',
  "opening_balance"          DECIMAL(12, 2)       NOT NULL,
  "opened_at"                TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "opened_by"                TEXT,
  "opened_via_bypass"        BOOLEAN              NOT NULL DEFAULT false,
  "opened_bypass_reason"     TEXT,
  "closed_at"                TIMESTAMP(3),
  "closed_by"                TEXT,
  "closing_balance_declared" DECIMAL(12, 2),
  "closing_balance_expected" DECIMAL(12, 2),
  "difference"               DECIMAL(12, 2),
  "notes"                    TEXT,
  "created_at"               TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3)         NOT NULL
);

CREATE UNIQUE INDEX "CashRegisterSession_external_id_key"
  ON "CashRegisterSession" ("external_id");
CREATE INDEX "CashRegisterSession_status_opened_at_idx"
  ON "CashRegisterSession" ("status", "opened_at");
CREATE INDEX "CashRegisterSession_closed_at_idx"
  ON "CashRegisterSession" ("closed_at");

-- Partial unique index: solo UNA sesión puede estar `open` simultáneamente.
-- Cuando se cierra, status cambia a 'closed' y el índice deja de aplicar.
CREATE UNIQUE INDEX "CashRegisterSession_only_one_open"
  ON "CashRegisterSession" (("status"))
  WHERE "status" = 'open';

-- ─── Payment ──────────────────────────────────────────────────────────────

CREATE TABLE "Payment" (
  "id"                       SERIAL PRIMARY KEY,
  "external_id"              TEXT             NOT NULL,
  "table_session_id"         INTEGER          NOT NULL,
  "cash_register_session_id" INTEGER          NOT NULL,
  "method"                   "PaymentMethod"  NOT NULL,
  "kind"                     "PaymentKind"    NOT NULL,
  "amount"                   DECIMAL(10, 2)   NOT NULL,
  "consumption_id"           INTEGER,
  "reference"                TEXT,
  "notes"                    TEXT,
  "created_by"               TEXT,
  "created_at"               TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Payment_table_session_id_fkey"
    FOREIGN KEY ("table_session_id") REFERENCES "TableSession"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT "Payment_cash_register_session_id_fkey"
    FOREIGN KEY ("cash_register_session_id") REFERENCES "CashRegisterSession"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,

  CONSTRAINT "Payment_consumption_id_fkey"
    FOREIGN KEY ("consumption_id") REFERENCES "Consumption"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Payment_external_id_key"
  ON "Payment" ("external_id");
CREATE UNIQUE INDEX "Payment_consumption_id_key"
  ON "Payment" ("consumption_id");
CREATE INDEX "Payment_table_session_id_created_at_idx"
  ON "Payment" ("table_session_id", "created_at");
CREATE INDEX "Payment_cash_register_session_id_method_idx"
  ON "Payment" ("cash_register_session_id", "method");
CREATE INDEX "Payment_method_created_at_idx"
  ON "Payment" ("method", "created_at");

-- ─── FKs cash_register_session_id en entidades existentes ─────────────────
--
-- Nullable porque las filas históricas (pre-Fase A+) no se atribuyen a
-- ninguna sesión. Las nuevas filas SÍ se atribuyen (el service exige
-- día abierto vía requireOpen()).

ALTER TABLE "Consumption" ADD COLUMN "cash_register_session_id" INTEGER;
ALTER TABLE "Consumption" ADD CONSTRAINT "Consumption_cash_register_session_id_fkey"
  FOREIGN KEY ("cash_register_session_id") REFERENCES "CashRegisterSession"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Consumption_cash_register_session_id_created_at_idx"
  ON "Consumption" ("cash_register_session_id", "created_at");

ALTER TABLE "ExtraIncome" ADD COLUMN "cash_register_session_id" INTEGER;
ALTER TABLE "ExtraIncome" ADD CONSTRAINT "ExtraIncome_cash_register_session_id_fkey"
  FOREIGN KEY ("cash_register_session_id") REFERENCES "CashRegisterSession"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "ExtraIncome_cash_register_session_id_created_at_idx"
  ON "ExtraIncome" ("cash_register_session_id", "created_at");

ALTER TABLE "LuggageTicket" ADD COLUMN "cash_register_session_id" INTEGER;
ALTER TABLE "LuggageTicket" ADD CONSTRAINT "LuggageTicket_cash_register_session_id_fkey"
  FOREIGN KEY ("cash_register_session_id") REFERENCES "CashRegisterSession"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "LuggageTicket_cash_register_session_id_created_at_idx"
  ON "LuggageTicket" ("cash_register_session_id", "created_at");

-- ─── Auto-día inicial (mitigación de seguridad al deploy) ─────────────────
--
-- Crea automáticamente UNA CashRegisterSession con opening_balance=0
-- marcada como bypass. Sin esto, el deploy del backend B2 dejaría el
-- bar paralizado porque todos los endpoints operativos exigen día
-- abierto (CASH_REGISTER_CLOSED 412).
--
-- El admin debe cerrar esta sesión cuanto antes y abrir una nueva con
-- la base de caja real. El bypass queda visible en reportes.

INSERT INTO "CashRegisterSession" (
  "external_id",
  "status",
  "opening_balance",
  "opened_at",
  "opened_by",
  "opened_via_bypass",
  "opened_bypass_reason",
  "notes",
  "updated_at"
)
SELECT
  gen_random_uuid()::TEXT,
  'open',
  0,
  CURRENT_TIMESTAMP,
  'system',
  true,
  'Auto-creado por migration 20260609010000 (Fase A+). Cerrar y reabrir con base real cuanto antes.',
  'Sesión auto-creada al deploy. Ver MIGRACION_SYNC.md sección Mitigaciones.',
  CURRENT_TIMESTAMP
-- Idempotencia: si ya hay una sesión open, no insertar (el partial
-- unique index también lo bloquearía, pero el WHERE evita el error).
WHERE NOT EXISTS (
  SELECT 1 FROM "CashRegisterSession" WHERE "status" = 'open'
);
