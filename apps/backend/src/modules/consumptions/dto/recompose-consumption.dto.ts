import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsPositive,
  Min,
  ValidateNested,
} from "class-validator";

/**
 * Editar el armado de UNA unidad de un compuesto ya servido — los
 * clientes cambian cervezas del cubetazo a mitad de noche (ej. 2
 * águilas por 2 pokers). El precio NO cambia (precio único por
 * cubetazo); solo se mueven inventario y el registro de composición.
 */
export class RecomposeOptionDto {
  @IsInt()
  @IsPositive()
  option_id!: number;

  @IsInt()
  @IsPositive()
  quantity!: number;
}

export class RecomposeSlotDto {
  @IsInt()
  @IsPositive()
  slot_id!: number;

  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => RecomposeOptionDto)
  options!: RecomposeOptionDto[];
}

export class RecomposeConsumptionDto {
  /** Cuál de las N unidades de la línea se re-arma (0-based). */
  @IsInt()
  @Min(0)
  unit_index!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RecomposeSlotDto)
  composition!: RecomposeSlotDto[];
}
