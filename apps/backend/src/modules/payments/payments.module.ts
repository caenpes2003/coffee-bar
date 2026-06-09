import { Global, Module } from "@nestjs/common";
import { PaymentsService } from "./payments.service";

/**
 * PaymentsModule — Fase A+.
 *
 * @Global porque PaymentsService es invocado por ConsumptionsService
 * (recordPartialPayment) y TableSessionsService (markPaid). Marcar
 * Global evita imports cruzados.
 *
 * No expone controller propio: las APIs de cobro siguen viviendo en
 * /bill/:sessionId/partial-payment y /table-sessions/:id/mark-paid
 * para no romper la API pública.
 */
@Global()
@Module({
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
