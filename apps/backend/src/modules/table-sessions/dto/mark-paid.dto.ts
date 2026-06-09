import { PaymentMethod } from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";

export class MarkPaidPaymentDto {
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/**
 * Cuerpo opcional para `POST /table-sessions/:id/mark-paid`.
 *
 * - Si `payments` se omite o llega vacío, el backend lo trata como un
 *   único cobro en EFECTIVO por el pendiente (retrocompat con la UI
 *   pre-Fase A+).
 * - Si llega con N entradas, la suma DEBE coincidir con el pendiente
 *   (tolerancia ±$0.5). Útil para cobros divididos: "30k tarjeta + 20k
 *   efectivo".
 */
export class MarkPaidDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MarkPaidPaymentDto)
  payments?: MarkPaidPaymentDto[];
}
