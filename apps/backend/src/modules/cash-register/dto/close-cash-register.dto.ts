import { Transform } from "class-transformer";
import { IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";
import { sanitizeText } from "../../../common/sanitize";

/**
 * Cerrar el día de caja activo.
 *
 * `closing_balance_declared` es el conteo físico de efectivo que hizo
 * el staff. El service calcula `closing_balance_expected` desde el
 * ledger (opening_balance + cobros en efectivo del día) y persiste
 * `difference = declared - expected` para auditoría histórica.
 *
 * Si declared está muy por debajo de expected es señal de plata
 * faltante (descuadre). Si está por encima, sobró efectivo (puede ser
 * propina sin registrar, error de tipeo, o vuelto mal dado).
 *
 * NO se acepta `closed_by` desde el body: lo setea el service
 * desde el actor autenticado.
 */
export class CloseCashRegisterDto {
  @IsInt()
  @Min(0)
  closing_balance_declared!: number;

  @IsOptional()
  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @MaxLength(500)
  notes?: string;
}
