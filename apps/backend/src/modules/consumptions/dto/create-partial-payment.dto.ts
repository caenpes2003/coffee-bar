import { PaymentMethod } from "@prisma/client";
import { IsEnum, IsNumber, IsPositive } from "class-validator";

export class CreatePartialPaymentDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsEnum(PaymentMethod)
  payment_method!: PaymentMethod;
}
