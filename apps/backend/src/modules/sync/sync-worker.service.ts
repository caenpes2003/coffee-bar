import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { OutboxStatus, type OutboxEvent } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { OutboxConfigService } from "../outbox/outbox-config.service";

/**
 * Worker de drain del outbox (corre en el nodo EMISOR — el local).
 *
 * Solo se activa si `SYNC_CLOUD_URL` está configurada: en el cloud
 * (que no tiene upstream) la env no existe y el worker queda apagado
 * — mismo binario para ambos roles, como manda ARQUITECTURA §1.
 *
 * Política (§4): polling cada 5s (sin Kafka, §15), lotes en orden
 * occurred_at ASC, backoff exponencial 1s/5s/30s/2min/10min/1h por
 * evento vía next_attempt_at, `pushed` al confirmar, `quarantined`
 * tras 10 intentos con error PERMANENTE (4xx) — nunca descartar
 * silenciosamente. Errores transitorios (red, 5xx) mantienen pending
 * con backoff.
 */
const POLL_MS = Number(process.env.SYNC_POLL_MS ?? 5_000);
const BATCH_SIZE = Number(process.env.SYNC_BATCH_SIZE ?? 50);
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 10;
// Backoff en segundos según push_attempts ya acumulados.
const BACKOFF_SECONDS = [1, 5, 30, 120, 600, 3600];

@Injectable()
export class SyncWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncWorkerService.name);
  private interval: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: OutboxConfigService,
  ) {}

  onModuleInit() {
    const cloudUrl = process.env.SYNC_CLOUD_URL;
    if (!cloudUrl) {
      this.logger.log(
        "SYNC_CLOUD_URL no configurada — worker de sync apagado (este nodo no tiene upstream; en el cloud esto es lo esperado).",
      );
      return;
    }
    if (!process.env.SYNC_INGEST_KEY) {
      this.logger.error(
        "SYNC_CLOUD_URL configurada pero falta SYNC_INGEST_KEY — el worker queda apagado hasta configurar ambas.",
      );
      return;
    }
    this.logger.log(
      `Worker de sync activo: drenando outbox hacia ${cloudUrl} cada ${POLL_MS}ms (lotes de ${BATCH_SIZE}).`,
    );
    this.interval = setInterval(() => {
      void this.tick();
    }, POLL_MS);
  }

  onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
  }

  /** Un ciclo de drain. Reentrada bloqueada (ticks lentos no se apilan). */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const batch = await this.prisma.outboxEvent.findMany({
        where: {
          status: OutboxStatus.pending,
          OR: [{ next_attempt_at: null }, { next_attempt_at: { lte: now } }],
        },
        orderBy: { occurred_at: "asc" },
        take: BATCH_SIZE,
      });
      if (batch.length === 0) return;
      await this.pushBatch(batch);
    } catch (err) {
      // El tick jamás tumba el proceso: el próximo lo reintenta.
      this.logger.error(
        `Tick de sync falló: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async pushBatch(batch: OutboxEvent[]): Promise<void> {
    const ids = batch.map((e) => e.id);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(
        `${process.env.SYNC_CLOUD_URL!.replace(/\/$/, "")}/sync/ingest`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-sync-key": process.env.SYNC_INGEST_KEY!,
          },
          body: JSON.stringify({
            node_id: this.config.nodeId,
            events: batch.map((e) => ({
              idempotency_key: e.idempotency_key,
              event_type: e.event_type,
              aggregate_type: e.aggregate_type,
              aggregate_id: e.aggregate_id,
              payload: e.payload,
              schema_version: e.schema_version,
              app_version: e.app_version,
              occurred_at: e.occurred_at.toISOString(),
            })),
          }),
          signal: controller.signal,
        },
      );
    } catch (err) {
      // Red caída / timeout: transitorio por definición.
      await this.markFailed(
        ids,
        `network: ${err instanceof Error ? err.message : String(err)}`,
        false,
      );
      return;
    } finally {
      clearTimeout(timeout);
    }

    if (response.ok) {
      await this.prisma.outboxEvent.updateMany({
        where: { id: { in: ids } },
        data: {
          status: OutboxStatus.pushed,
          pushed_at: new Date(),
          last_error: null,
          next_attempt_at: null,
        },
      });
      this.logger.log(`Push OK: ${ids.length} evento(s) → pushed`);
      return;
    }

    const body = await response.text().catch(() => "");
    // 4xx = el cloud nos entendió y dijo NO (nodo desconocido, payload
    // inválido, clave mala) — reintentar igual no lo va a arreglar
    // solo; tras MAX_ATTEMPTS pasa a quarantine con alerta. 5xx y
    // timeouts son transitorios.
    const permanent = response.status >= 400 && response.status < 500;
    await this.markFailed(
      ids,
      `HTTP ${response.status}: ${body.slice(0, 300)}`,
      permanent,
    );
  }

  private async markFailed(
    ids: bigint[],
    error: string,
    permanent: boolean,
  ): Promise<void> {
    // Backoff por lote usando el menor push_attempts del lote (los
    // lotes comparten destino y fallan juntos — precisión por evento
    // no paga su complejidad acá).
    const minAttempts = await this.prisma.outboxEvent.aggregate({
      where: { id: { in: ids } },
      _min: { push_attempts: true },
    });
    const attempts = (minAttempts._min.push_attempts ?? 0) + 1;
    const backoffSec =
      BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)];
    await this.prisma.outboxEvent.updateMany({
      where: { id: { in: ids } },
      data: {
        push_attempts: { increment: 1 },
        last_error: error,
        next_attempt_at: new Date(Date.now() + backoffSec * 1000),
      },
    });
    this.logger.warn(
      `Push falló (${ids.length} evento(s), intento ~${attempts}, retry en ${backoffSec}s): ${error}`,
    );

    if (permanent) {
      const quarantined = await this.prisma.outboxEvent.updateMany({
        where: {
          id: { in: ids },
          push_attempts: { gte: MAX_ATTEMPTS },
          status: OutboxStatus.pending,
        },
        data: { status: OutboxStatus.quarantined },
      });
      if (quarantined.count > 0) {
        // Nunca descartar silenciosamente (§4): esto debe doler.
        this.logger.error(
          `⚠ ${quarantined.count} evento(s) EN CUARENTENA tras ${MAX_ATTEMPTS} intentos con error permanente. Revisar last_error y reprocesar a mano.`,
        );
      }
    }
  }
}
