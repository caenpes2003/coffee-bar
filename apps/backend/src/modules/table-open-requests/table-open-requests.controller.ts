import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtGuard } from "../auth/guards/jwt.guard";
import { AuthKinds } from "../auth/guards/decorators";
import { CurrentAuth } from "../auth/guards/current-auth.decorator";
import type { AuthPayload } from "../auth/types";
import { RequireOpenCashRegisterGuard } from "../cash-register/require-open-cash-register.guard";
import { CreateTableOpenRequestDto } from "./dto/create-table-open-request.dto";
import { TableOpenRequestsService } from "./table-open-requests.service";

@Controller()
export class TableOpenRequestsController {
  constructor(private readonly service: TableOpenRequestsService) {}

  /**
   * Cliente (TABLE token del QR) pide acceso con el código del bar.
   * Mesa abierta → se une directo (session_token en la respuesta).
   * Mesa cerrada → solicitud pending para el admin; el dispositivo
   * recibe un claim_token para reclamar el resultado.
   *
   * Rate-limited (ver rate-limit.middleware) — junto con el rate limit
   * de /access-code/validate acota el brute-force del código.
   */
  @Post("table-open-requests")
  @UseGuards(JwtGuard, RequireOpenCashRegisterGuard)
  @AuthKinds("table")
  async create(
    @Body() dto: CreateTableOpenRequestDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    if (auth.kind !== "table" || auth.table_id !== dto.table_id) {
      throw new ForbiddenException({
        message: "Table token does not match requested table",
        code: "AUTH_TABLE_MISMATCH",
      });
    }
    return this.service.create(dto.table_id, dto.access_code);
  }

  /**
   * Público — el claim_token uuid ES la credencial (el dispositivo
   * en espera no tiene ningún otro token de sesión). Entrega única.
   */
  @Get("table-open-requests/claim")
  async claim(@Query("token") token: string) {
    return this.service.claim((token ?? "").trim());
  }

  @Get("admin/table-open-requests")
  @UseGuards(JwtGuard)
  @AuthKinds("admin")
  async listPending() {
    return this.service.listPending();
  }

  @Post("admin/table-open-requests/:id/approve")
  @UseGuards(JwtGuard, RequireOpenCashRegisterGuard)
  @AuthKinds("admin")
  async approve(
    @Param("id", ParseIntPipe) id: number,
    @CurrentAuth() auth: AuthPayload,
  ) {
    if (auth.kind !== "admin") {
      throw new ForbiddenException({
        message: "Admin token required",
        code: "AUTH_NOT_ADMIN",
      });
    }
    return this.service.approve(id, { user_id: auth.sub, name: auth.name });
  }

  @Post("admin/table-open-requests/:id/reject")
  @UseGuards(JwtGuard)
  @AuthKinds("admin")
  async reject(
    @Param("id", ParseIntPipe) id: number,
    @CurrentAuth() auth: AuthPayload,
  ) {
    if (auth.kind !== "admin") {
      throw new ForbiddenException({
        message: "Admin token required",
        code: "AUTH_NOT_ADMIN",
      });
    }
    return this.service.reject(id, { user_id: auth.sub, name: auth.name });
  }
}
