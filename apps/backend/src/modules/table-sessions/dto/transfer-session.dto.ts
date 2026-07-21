import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

/**
 * Body para POST /table-sessions/:id/transfer.
 *
 * Exactamente UNO de los dos campos (el service lo valida):
 *   - target_table_id: mover a mesa/barra existente y libre.
 *   - new_bar_name: crear barra virtual nueva y mover ahí.
 */
export class TransferSessionDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  target_table_id?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  new_bar_name?: string;
}
