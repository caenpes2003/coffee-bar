import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

/**
 * Body para POST /admin/bar-balance.
 *
 * `code` se valida contra el código quemado en BarBalanceService —
 * NO contra este DTO (el DTO solo declara el shape).
 */
export class SetBarBalanceDto {
  @IsString()
  @MaxLength(20)
  code!: string;

  @IsInt()
  @Min(0)
  cash_amount!: number;

  @IsInt()
  @Min(0)
  bold_amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
