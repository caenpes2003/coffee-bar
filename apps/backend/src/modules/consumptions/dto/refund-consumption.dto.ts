import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { sanitizeText } from "../../../common/sanitize";

export class RefundConsumptionDto {
  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;

  @IsOptional()
  @Transform(({ value }) => sanitizeText(value))
  @IsString()
  @MaxLength(500)
  notes?: string;

  /**
   * Si true (default), repone el stock al revertir la venta. Para
   * productos compuestos repone los componentes según el
   * OrderItemComponent persistido. Si false, se reversa solo el
   * dinero (el producto se considera consumido/desechado).
   */
  @IsOptional()
  @IsBoolean()
  restore_stock?: boolean;
}
