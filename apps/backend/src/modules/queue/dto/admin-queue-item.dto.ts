import { IsInt, IsNotEmpty, IsOptional, IsPositive, IsString } from "class-validator";

export class AdminQueueItemDto {
  @IsString()
  @IsNotEmpty()
  youtube_id!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsInt()
  @IsPositive()
  duration!: number;

  @IsInt()
  @IsOptional()
  table_id?: number;

  @IsInt()
  @IsOptional()
  position?: number;
}
