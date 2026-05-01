import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsPositive,
  Max,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

class UpdateOrderRequestItemDto {
  @IsInt()
  @IsPositive()
  product_id!: number;

  @IsInt()
  @IsPositive()
  @Max(50)
  quantity!: number;
}

/**
 * Body for PATCH /order-requests/:id. Replaces the items list of a still-
 * pending request. The customer cannot change `table_session_id` here —
 * the route is scoped to its own pending request via the auth token.
 */
export class UpdateOrderRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpdateOrderRequestItemDto)
  items!: UpdateOrderRequestItemDto[];
}
