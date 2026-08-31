import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Post,
  ServiceUnavailableException,
} from "@nestjs/common";
import { IngestBatchDto } from "./dto/ingest-batch.dto";
import { SyncIngestService } from "./sync-ingest.service";

/**
 * POST /sync/ingest — receptor de lotes del outbox de los nodos
 * locales. Auth nodo→nodo por clave compartida en header `x-sync-key`
 * (env SYNC_INGEST_KEY): no es un endpoint de usuarios, es de
 * máquinas, y la clave viaja solo entre backends por HTTPS.
 *
 * Sin la env configurada el endpoint responde 503 — un nodo local
 * jamás debe aceptar ingests (solo el cloud la configura).
 */
@Controller("sync")
export class SyncController {
  constructor(private readonly ingest: SyncIngestService) {}

  @Post("ingest")
  async ingestBatch(
    @Body() dto: IngestBatchDto,
    @Headers("x-sync-key") key?: string,
  ) {
    const required = process.env.SYNC_INGEST_KEY;
    if (!required) {
      throw new ServiceUnavailableException({
        message: "Sync ingest is not enabled on this node",
        code: "SYNC_INGEST_DISABLED",
      });
    }
    if (key !== required) {
      throw new ForbiddenException({
        message: "Invalid sync key",
        code: "SYNC_KEY_INVALID",
      });
    }
    return this.ingest.ingest(dto);
  }
}
