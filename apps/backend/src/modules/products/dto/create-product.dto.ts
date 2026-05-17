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

export class CreateProductDto {
  // Identificador estable y único. Opcional al crear desde la UI; si
  // no viene el service lo autogenera del nombre. Necesario para que
  // imports/seeds puedan upsertear sin depender del nombre exacto.
  @IsOptional()
  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  sku?: string;

  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @MaxLength(500)
  description?: string;

  // El bar siempre cobra en pesos enteros (no se usan centavos). Forzar
  // `@IsInt` rechaza cargas erróneas tipo $3.333,50 o $3.333,33 que
  // generarían totales con fracciones imposibles de cuadrar en caja.
  // Si en el futuro Crown Bar quisiera cobrar centavos, esto cambia y
  // se reactiva el control vía `maxDecimalPlaces`.
  @IsInt()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  low_stock_threshold?: number;

  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  category!: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
