import { IsEnum, IsIn, IsOptional } from "class-validator";
import { PaymentMethod } from "@prisma/client";

/**
 * Cambiar el estado de pago de una maleta (típico: pending → paid).
 * El monto es fijo, no se toca; solo se marca cuando el cliente paga
 * al ingresar o al retirar.
 *
 * `method` acompaña el paso a paid: con qué pagó el cliente. La UI lo
 * manda siempre (sin default); opcional acá solo por retrocompat de
 * deploy — sin él se conserva el método que ya tenga la fila.
 */
export class UpdateLuggagePaymentDto {
  @IsIn(["pending", "paid"])
  payment_status!: "pending" | "paid";

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;
}
