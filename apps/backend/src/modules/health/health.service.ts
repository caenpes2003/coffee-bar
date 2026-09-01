import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { InboxStatus, OutboxStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { OutboxConfigService } from "../outbox/outbox-config.service";

/**
 * Health real (MVP 2): antes era un stub que SIEMPRE respondía 200 —
 * inútil para el edge gateway del §10 de ARQUITECTURA (daría por vivo
 * un nodo con la BD caída) y para el dashboard de nodos.
 *
 * Ahora la respuesta incluye identidad del nodo, versión de schema y
 * el pendiente del outbox (la métrica operativa clave del sync), y el
 * count contra la BD funciona de sonda: si la BD no responde, /health
 * devuelve 503 — que es exactamente lo que un health check debe hacer.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: OutboxConfigService,
  ) {}

  async getHealth() {
    // Auditoría de sync: las cuatro preguntas operativas — último
    // enviado, último recibido, último aplicado, y cuántos hay en
    // pending / retry / quarantine — respondibles con UN curl.
    try {
      const [
        outboxByStatus,
        lastPushed,
        oldestPending,
        inboxByStatus,
        lastApplied,
        oldestReceived,
      ] = await Promise.all([
        this.prisma.outboxEvent.groupBy({
          by: ["status"],
          _count: { _all: true },
        }),
        this.prisma.outboxEvent.aggregate({ _max: { pushed_at: true } }),
        this.prisma.outboxEvent.aggregate({
          where: { status: OutboxStatus.pending },
          _min: { occurred_at: true },
        }),
        this.prisma.inboxEvent.groupBy({
          by: ["status"],
          _count: { _all: true },
        }),
        this.prisma.inboxEvent.aggregate({ _max: { applied_at: true } }),
        this.prisma.inboxEvent.aggregate({
          where: { status: InboxStatus.received },
          _min: { occurred_at: true },
        }),
      ]);
      const outCount = (s: OutboxStatus) =>
        outboxByStatus.find((r) => r.status === s)?._count._all ?? 0;
      const inCount = (s: InboxStatus) =>
        inboxByStatus.find((r) => r.status === s)?._count._all ?? 0;
      return {
        status: "ok",
        service: "backend",
        node_id: this.config.nodeId,
        schema_version: this.config.schemaVersion,
        app_version: this.config.appVersion,
        // Salida (este nodo como emisor).
        outbox_pending: outCount(OutboxStatus.pending),
        outbox_quarantined: outCount(OutboxStatus.quarantined),
        outbox_last_pushed_at:
          lastPushed._max.pushed_at?.toISOString() ?? null,
        outbox_oldest_pending_at:
          oldestPending._min.occurred_at?.toISOString() ?? null,
        // Entrada (este nodo como receptor — el cloud).
        inbox_received: inCount(InboxStatus.received),
        inbox_quarantined: inCount(InboxStatus.quarantined),
        inbox_last_applied_at:
          lastApplied._max.applied_at?.toISOString() ?? null,
        inbox_oldest_received_at:
          oldestReceived._min.occurred_at?.toISOString() ?? null,
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException({
        status: "error",
        service: "backend",
        node_id: this.config.nodeId,
        reason: "db_unreachable",
        timestamp: new Date().toISOString(),
      });
    }
  }
}
