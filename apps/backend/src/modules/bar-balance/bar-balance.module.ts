import { Module } from "@nestjs/common";
import { BarBalanceController } from "./bar-balance.controller";
import { BarBalanceService } from "./bar-balance.service";

/**
 * BarBalanceModule — saldo total del bar (efectivo + Bold), derivado
 * de la línea base manual + los cierres de jornada posteriores.
 *
 * No es @Global: nadie más lo inyecta hoy. Si el ticket de cierre
 * quisiera mostrar el saldo proyectado algún día, se exporta y listo.
 */
@Module({
  controllers: [BarBalanceController],
  providers: [BarBalanceService],
  exports: [BarBalanceService],
})
export class BarBalanceModule {}
