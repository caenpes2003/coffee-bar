import { IsInt, IsPositive } from "class-validator";

export class OpenSessionDto {
  @IsInt()
  @IsPositive()
  table_id!: number;
}
