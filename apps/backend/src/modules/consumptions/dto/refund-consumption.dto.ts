import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class RefundConsumptionDto {
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
