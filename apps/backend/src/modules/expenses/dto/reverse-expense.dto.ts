import { IsString, MaxLength, MinLength } from "class-validator";

/**
 * Body para POST /admin/expenses/:id/reverse.
 *
 * Razón obligatoria en texto libre (no enum, a diferencia de Payment
 * reversal). Para gastos los motivos son demasiado variados ("registré
 * mal el monto", "no era el método correcto", "cambio de proveedor",
 * "lo cobramos al final como descuento", etc.) y un enum cerrado
 * sería más limitante que útil.
 */
export class ReverseExpenseDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
