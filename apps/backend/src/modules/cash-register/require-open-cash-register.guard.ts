import {
  CanActivate,
  ExecutionContext,
  Injectable,
  PreconditionFailedException,
} from "@nestjs/common";
import { CashRegisterService } from "./cash-register.service";

/**
 * Guard que rechaza el request con 412 CASH_REGISTER_CLOSED si no hay
 * sesión de caja activa. Se aplica a endpoints operativos que generan
 * cobros, pedidos, ingresos o aperturas de mesa.
 *
 * NO se aplica a:
 *   - lectura (GETs)
 *   - cierre de mesas (markPaid / void / close) — deben poder terminar
 *     in-flight aunque el día se haya cerrado
 *   - refunds (revertir algo ya cobrado en sesión previa)
 *   - login, abrir/cerrar día, GET de cash-register
 *
 * Uso típico:
 *
 *   @UseGuards(JwtGuard, RequireOpenCashRegisterGuard)
 *   @Post("/some-endpoint")
 *   ...
 *
 * NOTA: el guard hace UN findFirst extra por request. Para volumen
 * actual del bar (~unos cientos de req/día) es despreciable. Si
 * crece, cachear la sesión activa en memoria con invalidación al
 * open/close es trivial.
 */
@Injectable()
export class RequireOpenCashRegisterGuard implements CanActivate {
  constructor(private readonly cashRegister: CashRegisterService) {}

  async canActivate(_context: ExecutionContext): Promise<boolean> {
    const open = await this.cashRegister.getCurrentOpen();
    if (!open) {
      throw new PreconditionFailedException({
        message:
          "Cash register is closed. Open the day before operating.",
        code: "CASH_REGISTER_CLOSED",
      });
    }
    return true;
  }
}
