import { IsOptional, IsString, MaxLength } from "class-validator";

export class RejectOrderRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
