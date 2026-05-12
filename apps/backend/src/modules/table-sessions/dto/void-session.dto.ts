import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { SessionVoidReason } from "@prisma/client";

/**
 * Cuerpo del POST /table-sessions/:id/void.
 *
 * `reason` es enum predefinido (customer_left | admin_error | comp | other)
 * para que los reportes puedan agrupar voids por motivo.
 *
 * `other_detail` es texto libre opcional. Lo permitimos siempre (no
 * exclusivamente para reason="other") porque a veces el operador quiere
 * agregar contexto incluso a un caso típico ("se fue sin pagar — habían
 * pedido la cuenta y se les distrajo el mesero"). El service enforce que
 * sea NO vacío cuando reason=="other".
 */
export class VoidSessionDto {
  @IsEnum(SessionVoidReason, {
    message:
      "reason must be one of: customer_left, admin_error, comp, other",
  })
  reason!: SessionVoidReason;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  other_detail?: string;
}
