import { Injectable, Logger, OnModuleInit } from "@nestjs/common";

/**
 * Configuración del módulo outbox. Lee las env vars una vez al boot,
 * las valida y las expone tipadas. Centraliza el conocimiento de:
 *   - qué nodo somos (NODE_ID)
 *   - qué versión de schema usamos (SCHEMA_VERSION)
 *   - qué versión de app está corriendo (APP_VERSION)
 *
 * Ver ARQUITECTURA.md §3 (identidad nodo), §4 (versionado de eventos),
 * §3.5 (NodeRegistry).
 *
 * Defaults razonables para desarrollo: si NODE_ID no está, asumimos
 * "cloud" (el nodo Railway). Mini-PCs siempre setean NODE_ID explícito
 * en su .env.local. Para SCHEMA_VERSION usamos la fecha del schema
 * actual; cambia con cada migration relevante.
 *
 * Nota: NO valida que NODE_ID exista en NodeRegistry — eso sería
 * acoplar el bootstrap a la BD. El service que pushea al cloud (futuro
 * worker) puede chequear ese contrato.
 */
@Injectable()
export class OutboxConfigService implements OnModuleInit {
  private readonly logger = new Logger(OutboxConfigService.name);

  readonly nodeId: string;
  readonly schemaVersion: string;
  readonly appVersion: string;

  constructor() {
    this.nodeId = process.env.NODE_ID?.trim() || "cloud";
    this.schemaVersion =
      process.env.SCHEMA_VERSION?.trim() || "2026.06.08.1";
    // Si APP_VERSION no está en env, intentamos package.json del backend.
    // Fallback final: literal "0.0.0-dev" — peor caso siempre arranca.
    this.appVersion =
      process.env.APP_VERSION?.trim() || this.readPackageVersion();
  }

  onModuleInit(): void {
    this.logger.log(
      `Outbox config — node_id=${this.nodeId} schema_version=${this.schemaVersion} app_version=${this.appVersion}`,
    );
  }

  private readPackageVersion(): string {
    try {
      // Resolución relativa al dist/ del runtime. Si falla, devolvemos
      // un literal — un missing package.json en runtime es raro pero
      // no debe tumbar el boot.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pkg = require("../../../package.json") as { version?: string };
      return pkg.version || "0.0.0-dev";
    } catch {
      return "0.0.0-dev";
    }
  }
}
