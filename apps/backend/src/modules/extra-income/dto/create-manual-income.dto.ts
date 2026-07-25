import { PaymentMethod } from "@prisma/client";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { Transform } from "class-transformer";
import { sanitizeText } from "../../../common/sanitize";

/**
 * Registrar un ingreso extra manual (concepto + monto libres). A
 * diferencia del cobro de baño donde el precio lo fuerza el backend,
 * aquí el operador es responsable del monto: son cobros puntuales
 * (bodegaje, rentas eventuales, etc.) que no merecen entrada en el
 * catálogo de productos.
 *
 * `concept` es obligatorio porque sin descripción el ingreso queda
 * imposible de auditar después. `amount` solo enteros (peso colombiano).
 */
export class CreateManualIncomeDto {
  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  concept!: string;

  @IsInt()
  @Min(1)
  amount!: number;

  /**
   * Método de pago. Opcional con default efectivo SOLO por
   * retrocompatibilidad de deploy — la UI siempre lo pide.
   */
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @MaxLength(200)
  notes?: string;
}
