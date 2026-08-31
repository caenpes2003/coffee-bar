import { Global, Module } from "@nestjs/common";
import { OutboxConfigService } from "./outbox-config.service";
import { OutboxEventService } from "./outbox-event.service";

/**
 * OutboxModule — infraestructura del Transactional Outbox.
 *
 * Marcado @Global porque OutboxEventService va a ser inyectado desde
 * casi todos los módulos operativos (consumptions, orders, table-sessions,
 * products/inventory, extra-income, luggage, etc.). Marcarlo Global
 * evita que cada uno tenga que importar OutboxModule en su imports[].
 *
 * Misma filosofía que AuthModule en este repo (también @Global).
 *
 * Exporta también OutboxConfigService: el worker de drain (módulo
 * sync) y el health check necesitan node_id/schema_version.
 */
@Global()
@Module({
  providers: [OutboxConfigService, OutboxEventService],
  exports: [OutboxEventService, OutboxConfigService],
})
export class OutboxModule {}
