-- Edición del armado de un compuesto ya servido (los clientes cambian
-- cervezas del cubetazo a mitad de noche). Solo un valor nuevo de
-- enum para auditar quién cambió qué. Idempotente.
ALTER TYPE "AuditEventKind" ADD VALUE IF NOT EXISTS 'composition_edited';
