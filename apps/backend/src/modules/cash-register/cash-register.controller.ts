import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CashRegisterStatus } from "@prisma/client";
import { AuthKinds } from "../auth/guards/decorators";
import { CurrentAuth } from "../auth/guards/current-auth.decorator";
import { JwtGuard } from "../auth/guards/jwt.guard";
import type { AuthPayload } from "../auth/types";
import { CashRegisterService, type Actor } from "./cash-register.service";
import { CloseCashRegisterDto } from "./dto/close-cash-register.dto";
import { OpenCashRegisterDto } from "./dto/open-cash-register.dto";

@Controller("admin/cash-register")
@UseGuards(JwtGuard)
@AuthKinds("admin")
export class CashRegisterController {
  constructor(private readonly service: CashRegisterService) {}

  /**
   * Sesión activa o null. Usado por el frontend admin para decidir si
   * mostrar el banner "abrir día" o el banner "día abierto desde X".
   */
  @Get("current")
  async getCurrent() {
    const session = await this.service.getCurrentOpen();
    return { session };
  }

  /**
   * Abrir el día. Falla con 409 si ya hay sesión activa.
   */
  @Post("open")
  open(
    @Body() dto: OpenCashRegisterDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    return this.service.open(dto, toActor(auth));
  }

  /**
   * Cerrar el día activo. Falla con 404 si no hay sesión open.
   */
  @Post("close")
  close(
    @Body() dto: CloseCashRegisterDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    return this.service.close(dto, toActor(auth));
  }

  /**
   * Histórico de sesiones (default últimas 50). Para el tab Caja del
   * admin que lista cierres pasados.
   */
  @Get()
  list(
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    return this.service.listSessions({
      status: parseStatus(status),
      limit: limit ? parseIntStrict(limit, "limit") : undefined,
    });
  }

  /**
   * Detalle de UNA sesión con totales por método de pago, extras,
   * luggage. Usado para mostrar el "ticket de cierre" en la UI.
   */
  @Get(":id/detail")
  getDetail(@Param("id", ParseIntPipe) id: number) {
    return this.service.getSessionDetail(id);
  }
}

function toActor(auth: AuthPayload | undefined): Actor {
  if (!auth || auth.kind !== "admin") return null;
  return { user_id: auth.sub, name: auth.name };
}

function parseStatus(value: string | undefined): CashRegisterStatus | undefined {
  if (!value) return undefined;
  if (value === "open") return CashRegisterStatus.open;
  if (value === "closed") return CashRegisterStatus.closed;
  throw new BadRequestException({
    message: `Invalid status: ${value}`,
    code: "CASH_REGISTER_INVALID_STATUS",
  });
}

function parseIntStrict(value: string, field: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new BadRequestException({
      message: `Invalid \`${field}\``,
      code: "CASH_REGISTER_INVALID_PARAM",
    });
  }
  return n;
}
