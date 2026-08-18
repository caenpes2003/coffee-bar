import { PaymentMethod } from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  ValidateNested,
} from "class-validator";

/**
 * Una línea de la cuenta que este pago parcial cubre: el Consumption
 * (type=product) y cuántas unidades de él se pagan. El monto por
 * línea NO viaja — lo calcula el server (unit_amount × quantity) para
 * que el cliente no pueda descuadrar la asignación.
 */
export class PartialPaymentAllocationInputDto {
  @IsInt()
  @IsPositive()
  consumption_id!: number;

  @IsInt()
  @IsPositive()
  quantity!: number;
}

export class CreatePartialPaymentDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsEnum(PaymentMethod)
  payment_method!: PaymentMethod;

  /**
   * Opcional: "cada quien paga lo suyo". Si viene, el server valida
   * que las líneas pertenezcan a la sesión, que las cantidades no
   * excedan lo aún no pagado, y que la suma calculada cuadre con
   * `amount`. Sin este campo, el parcial es un monto libre (modo
   * clásico) — también es el camino de retrocompat para frontends
   * viejos durante la ventana de deploy.
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PartialPaymentAllocationInputDto)
  allocations?: PartialPaymentAllocationInputDto[];
}
