import { Global, Module } from "@nestjs/common";
import { CashRegisterController } from "./cash-register.controller";
import { CashRegisterService } from "./cash-register.service";
import { RequireOpenCashRegisterGuard } from "./require-open-cash-register.guard";

/**
 * CashRegisterModule — gestión del día contable.
 *
 * @Global porque CashRegisterService.requireOpen() es invocado por
 * casi todos los módulos operativos (consumptions, orders,
 * order-requests, table-sessions, queue, extra-income, luggage).
 * Marcar Global evita que cada uno tenga que importar este módulo.
 *
 * El RequireOpenCashRegisterGuard se exporta también para que los
 * controllers de otros módulos puedan declararlo en @UseGuards.
 *
 * Mismo patrón que OutboxModule.
 */
@Global()
@Module({
  controllers: [CashRegisterController],
  providers: [CashRegisterService, RequireOpenCashRegisterGuard],
  exports: [CashRegisterService, RequireOpenCashRegisterGuard],
})
export class CashRegisterModule {}
