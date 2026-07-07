import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CurrentAuth } from "../auth/guards/current-auth.decorator";
import { AuthKinds } from "../auth/guards/decorators";
import { JwtGuard } from "../auth/guards/jwt.guard";
import type { AuthPayload } from "../auth/types";
import { BarBalanceService } from "./bar-balance.service";
import { SetBarBalanceDto } from "./dto/set-bar-balance.dto";

/**
 * Saldo del bar:
 *
 *   GET  /admin/bar-balance   saldo derivado actual (efectivo + Bold)
 *   POST /admin/bar-balance   fijar/corregir línea base (requiere código)
 *
 * Ambos requieren admin auth. El POST además exige el código de
 * autorización validado server-side — la edición está deliberadamente
 * escondida en la UI y este es el segundo candado.
 */
@Controller("admin/bar-balance")
@UseGuards(JwtGuard)
@AuthKinds("admin")
export class BarBalanceController {
  constructor(private readonly service: BarBalanceService) {}

  @Get()
  getCurrent() {
    return this.service.getCurrent();
  }

  @Post()
  setBaseline(
    @Body() dto: SetBarBalanceDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    const actor =
      auth && auth.kind === "admin"
        ? { user_id: auth.sub, name: auth.name }
        : null;
    return this.service.setBaseline({
      code: dto.code,
      cash_amount: dto.cash_amount,
      bold_amount: dto.bold_amount,
      note: dto.note,
      actor,
    });
  }
}
