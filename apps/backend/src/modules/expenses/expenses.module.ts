import { Global, Module } from "@nestjs/common";
import { ExpensesController } from "./expenses.controller";
import { ExpensesService } from "./expenses.service";

/**
 * ExpensesModule — Fase A+ Gastos v1.
 *
 * @Global porque ExpensesService.summaryForSession() es invocado por
 * CashRegisterService.getSessionDetail() y close() para netear el
 * expected. Sin Global, CashRegisterModule tendría que importarlo
 * explícitamente y se rompe la posibilidad de que otros módulos lo
 * reusen en el futuro sin pensar.
 *
 * Mismo patrón que PaymentsModule y CashRegisterModule.
 */
@Global()
@Module({
  controllers: [ExpensesController],
  providers: [ExpensesService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
