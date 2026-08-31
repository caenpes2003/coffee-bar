import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { OutboxStatus } from "@prisma/client";
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
    let outboxPending: number;
    try {
      outboxPending = await this.prisma.outboxEvent.count({
        where: { status: OutboxStatus.pending },
      });
    } catch {
      throw new ServiceUnavailableException({
        status: "error",
        service: "backend",
        node_id: this.config.nodeId,
        reason: "db_unreachable",
        timestamp: new Date().toISOString(),
      });
    }
    return {
      status: "ok",
      service: "backend",
      node_id: this.config.nodeId,
      schema_version: this.config.schemaVersion,
      app_version: this.config.appVersion,
      outbox_pending: outboxPending,
      timestamp: new Date().toISOString(),
    };
  }
}
