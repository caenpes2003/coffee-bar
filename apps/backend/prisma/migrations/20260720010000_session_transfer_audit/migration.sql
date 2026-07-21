-- Transferencia de cuentas entre mesas/barras: nuevo kind de auditoría.
-- Idempotente.
ALTER TYPE "AuditEventKind" ADD VALUE IF NOT EXISTS 'session_transferred';
