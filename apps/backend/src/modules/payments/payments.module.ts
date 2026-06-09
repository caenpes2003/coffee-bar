import { Global, Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";

/**
 * PaymentsModule — Fase A+.
 *
 * @Global porque PaymentsService es invocado por ConsumptionsService
 * (recordPartialPayment) y TableSessionsService (markPaid). Marcar
 * Global evita imports cruzados.
 *
 * Expone un controller único en /admin/payments para el reverso de
 * cobros (POST :id/reverse). Los cobros (partial, final) siguen
 * viviendo en sus controllers de dominio (/bill, /table-sessions)
 * para no romper la API pública.
 */
@Global()
@Module({
  imports: [AuditLogModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
