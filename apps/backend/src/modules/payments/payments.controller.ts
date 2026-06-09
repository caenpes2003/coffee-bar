import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CurrentAuth } from "../auth/guards/current-auth.decorator";
import { AuthKinds } from "../auth/guards/decorators";
import { JwtGuard } from "../auth/guards/jwt.guard";
import type { AuthPayload } from "../auth/types";
import { AuditLogService } from "../audit-log/audit-log.service";
import { ReversePaymentDto } from "./dto/reverse-payment.dto";
import { PaymentsService } from "./payments.service";

/**
 * Endpoints de Payments. Hoy expone solo el reverso — los cobros
 * (partial, final) siguen viviendo en sus controllers de dominio
 * (/bill/:sessionId/partial-payment, /table-sessions/:id/mark-paid)
 * para no romper la API pública.
 *
 *   POST /admin/payments/:id/reverse   reversar un Payment previo
 *
 * El reverso requiere admin auth y razón obligatoria. NO requiere
 * RequireOpenCashRegisterGuard porque el service ya valida (con un
 * 412 más específico) que haya un día abierto al que atribuir el
 * descuento — pasar por el guard genérico sería redundante.
 */
@Controller("admin/payments")
@UseGuards(JwtGuard)
@AuthKinds("admin")
export class PaymentsController {
  constructor(
    private readonly service: PaymentsService,
    private readonly audit: AuditLogService,
  ) {}

  @Post(":id/reverse")
  async reverse(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ReversePaymentDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    const actor =
      auth && auth.kind === "admin"
        ? { user_id: auth.sub, name: auth.name }
        : null;
    const reversal = await this.service.reverse(id, {
      reason: dto.reason,
      reason_detail: dto.reason_detail,
      actor,
    });
    if (auth && auth.kind === "admin") {
      void this.audit.record({
        kind: "payment_reversed",
        actor_id: auth.sub,
        actor_label: auth.name,
        payment_id: id,
        reversal_id: reversal.id,
        table_session_id: reversal.table_session_id,
        method: reversal.method,
        amount: Number(reversal.amount),
        reason: dto.reason,
        reason_detail: dto.reason_detail ?? null,
      });
    }
    return {
      id: reversal.id,
      external_id: reversal.external_id,
      table_session_id: reversal.table_session_id,
      cash_register_session_id: reversal.cash_register_session_id,
      method: reversal.method,
      kind: reversal.kind,
      amount: Number(reversal.amount),
      reverses_id: reversal.reverses_id,
      reverse_reason: reversal.reverse_reason,
      reverse_reason_detail: reversal.reverse_reason_detail,
      created_at: reversal.created_at,
      created_by: reversal.created_by,
    };
  }
}
