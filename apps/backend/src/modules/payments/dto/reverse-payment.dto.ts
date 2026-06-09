import { PaymentReverseReason } from "@prisma/client";
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/**
 * Body para `POST /admin/payments/:id/reverse`.
 *
 * reason es enum cerrado. Si reason === 'other', reason_detail es
 * obligatorio (el service lo valida; aquí solo declaramos el shape).
 */
export class ReversePaymentDto {
  @IsEnum(PaymentReverseReason)
  reason!: PaymentReverseReason;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason_detail?: string;
}
