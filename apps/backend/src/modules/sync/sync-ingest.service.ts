import {
  ForbiddenException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { IngestBatchDto } from "./dto/ingest-batch.dto";

/**
 * Lado RECEPTOR del transporte de sync (corre en el cloud).
 *
 * Fase 1: zona de aterrizaje durable. Cada evento se inserta en
 * InboxEvent con dedup por (node_id, idempotency_key) — un reintento
 * tras un ACK perdido cae en el unique y se cuenta como duplicado,
 * respuesta 200 igual (el emisor marca pushed y sigue). CERO mutación
 * del estado del cloud: los appliers que materializan cada event_type
 * en sus tablas son la Fase 2.
 *
 * El batch además funciona como heartbeat del nodo emisor: actualiza
 * NodeRegistry.last_seen_at / app_version / schema_version.
 */
@Injectable()
export class SyncIngestService {
  private readonly logger = new Logger(SyncIngestService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ingest(dto: IngestBatchDto): Promise<{
    ok: true;
    received: number;
    duplicates: number;
  }> {
    // Nodo emisor debe estar aprovisionado y activo en NodeRegistry.
    // El alta de un local nuevo es un INSERT manual/consciente — no
    // auto-registramos nodos desconocidos.
    const node = await this.prisma.nodeRegistry.findUnique({
      where: { node_id: dto.node_id },
    });
    if (!node || !node.is_active) {
      throw new ForbiddenException({
        message: `Node ${dto.node_id} is not registered or inactive`,
        code: "SYNC_UNKNOWN_NODE",
      });
    }

    // Heartbeat: el push exitoso ES la señal de vida del local.
    const sample = dto.events[0];
    await this.prisma.nodeRegistry.update({
      where: { node_id: dto.node_id },
      data: {
        last_seen_at: new Date(),
        app_version: sample.app_version,
        schema_version: sample.schema_version,
      },
    });

    // createMany + skipDuplicates: el unique (node_id, idempotency_key)
    // absorbe los reintentos sin error.
    const result = await this.prisma.inboxEvent.createMany({
      data: dto.events.map((e) => ({
        node_id: dto.node_id,
        idempotency_key: e.idempotency_key,
        event_type: e.event_type,
        aggregate_type: e.aggregate_type,
        aggregate_id: e.aggregate_id,
        payload: e.payload as object,
        schema_version: e.schema_version,
        app_version: e.app_version,
        occurred_at: new Date(e.occurred_at),
      })),
      skipDuplicates: true,
    });

    const duplicates = dto.events.length - result.count;
    if (result.count > 0 || duplicates > 0) {
      this.logger.log(
        `Ingest de ${dto.node_id}: ${result.count} nuevos, ${duplicates} duplicados`,
      );
    }
    return { ok: true, received: result.count, duplicates };
  }
}
