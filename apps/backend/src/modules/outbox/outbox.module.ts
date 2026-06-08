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
 * Esta primera versión solo exporta el service de enqueue. El worker
 * de drain (consume pending → push al cloud) entra en un commit
 * posterior; al hacerlo, vivirá en este mismo módulo y se exportará
 * desde acá.
 */
@Global()
@Module({
  providers: [OutboxConfigService, OutboxEventService],
  exports: [OutboxEventService],
})
export class OutboxModule {}
