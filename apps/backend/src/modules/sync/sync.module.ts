import { Module } from "@nestjs/common";
import { SyncController } from "./sync.controller";
import { SyncIngestService } from "./sync-ingest.service";
import { SyncWorkerService } from "./sync-worker.service";

/**
 * Transporte de sync local ⇄ cloud (MVP 2, Fase 1).
 *
 * El mismo binario carga ambos roles y las env deciden cuál actúa:
 *   - Cloud: SYNC_INGEST_KEY seteada → acepta POST /sync/ingest.
 *   - Local: SYNC_CLOUD_URL + SYNC_INGEST_KEY → el worker drena el
 *     outbox hacia el cloud cada 5s.
 *   - Un nodo sin envs no hace nada de sync (estado actual del cloud
 *     hasta que exista el primer local).
 */
@Module({
  controllers: [SyncController],
  providers: [SyncIngestService, SyncWorkerService],
})
export class SyncModule {}
