-- MVP 2 — Fase 2 (appliers): backoff del aplicador de InboxEvent.
-- Un evento cuyo padre aún no llegó (o con error transitorio) espera
-- hasta next_attempt_at antes de reintentar. Idempotente.
ALTER TABLE "InboxEvent"
  ADD COLUMN IF NOT EXISTS "next_attempt_at" TIMESTAMP(3);
