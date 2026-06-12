import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { Payment } from "@prisma/client";
import { CurrentAuth } from "../auth/guards/current-auth.decorator";
import { AuthKinds } from "../auth/guards/decorators";
import { JwtGuard } from "../auth/guards/jwt.guard";
import type { AuthPayload } from "../auth/types";
import { AuditLogService } from "../audit-log/audit-log.service";
import { ReversePaymentDto } from "./dto/reverse-payment.dto";
import { PaymentsService } from "./payments.service";

/**
 * Endpoints de Payments. Los cobros (partial, final) siguen viviendo
 * en sus controllers de dominio (/bill/:sessionId/partial-payment,
 * /table-sessions/:id/mark-paid) para no romper la API pública.
 *
 *   GET  /admin/payments/by-session/:sessionId   listar pagos de una mesa
 *   POST /admin/payments/:id/reverse              reversar un Payment previo
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

  /**
   * Lista los Payments asociados a una TableSession (parciales,
   * finales y reversos). Usado por el detalle de mesa para mostrar
   * el desglose y exponer la acción "reversar" por fila.
   */
  @Get("by-session/:sessionId")
  async listForSession(
    @Param("sessionId", ParseIntPipe) sessionId: number,
  ) {
    const payments = await this.service.listForSession(sessionId);
    return payments.map(serialize);
  }

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
    return serialize(reversal);
  }
}

/**
 * Decimal → number, DateTime → ISO string. Mismo shape que el tipo
 * `Payment` que el frontend declara en @coffee-bar/shared (consumido
 * por paymentsApi).
 */
function serialize(p: Payment) {
  return {
    id: p.id,
    external_id: p.external_id,
    table_session_id: p.table_session_id,
    cash_register_session_id: p.cash_register_session_id,
    method: p.method,
    kind: p.kind,
    amount: Number(p.amount),
    consumption_id: p.consumption_id,
    reverses_id: p.reverses_id,
    reverse_reason: p.reverse_reason,
    reverse_reason_detail: p.reverse_reason_detail,
    reference: p.reference,
    notes: p.notes,
    created_by: p.created_by,
    created_at: p.created_at.toISOString(),
  };
}
