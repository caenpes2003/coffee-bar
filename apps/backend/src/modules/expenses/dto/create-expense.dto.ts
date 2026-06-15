import { ExpenseCategory, PaymentMethod } from "@prisma/client";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

/**
 * Body para POST /admin/expenses.
 *
 * concept es obligatorio. supplier / receipt_number / notes son
 * opcionales pero útiles para auditoría posterior.
 */
export class CreateExpenseDto {
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsEnum(ExpenseCategory)
  category!: ExpenseCategory;

  @IsInt()
  @Min(1)
  amount!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  concept!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  supplier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  receipt_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
