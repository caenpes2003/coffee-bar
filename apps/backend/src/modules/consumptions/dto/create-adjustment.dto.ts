import { IsEnum, IsNumber, IsOptional, IsString, MaxLength, MinLength, NotEquals } from "class-validator";

export enum AdjustmentKind {
  adjustment = "adjustment",
  discount = "discount",
}

export class CreateAdjustmentDto {
  @IsEnum(AdjustmentKind)
  type!: AdjustmentKind;

  @IsNumber({ maxDecimalPlaces: 2 })
  @NotEquals(0)
  amount!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  created_by?: string;
}
