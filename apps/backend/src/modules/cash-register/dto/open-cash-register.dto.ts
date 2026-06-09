import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { sanitizeText } from "../../../common/sanitize";

/**
 * Abrir un nuevo día de caja.
 *
 * Reglas:
 *   - opening_balance es obligatorio salvo en modo bypass.
 *   - Si bypass=true, opening_balance puede ser 0 pero
 *     bypass_reason es obligatorio (mínimo 3 chars).
 *   - El bypass es escape de emergencia documentado:
 *     queda persistido y visible en reportes para que se note que
 *     ese día tuvo apertura irregular.
 *
 * NO se acepta `opened_by` desde el body: lo setea el service
 * desde el actor autenticado (anti-suplantación).
 */
export class OpenCashRegisterDto {
  @IsInt()
  @Min(0)
  opening_balance!: number;

  @IsOptional()
  @IsBoolean()
  bypass?: boolean;

  @IsOptional()
  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  bypass_reason?: string;

  @IsOptional()
  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @MaxLength(500)
  notes?: string;
}
