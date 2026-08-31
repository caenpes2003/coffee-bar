import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";

/**
 * Un evento del outbox del nodo emisor, tal como viaja por el wire.
 * El payload NO se valida acá contra el registry — el emisor ya lo
 * validó al encolar y el receptor lo almacena tal cual (los appliers
 * de Fase 2 validan/migran al aplicar, con quarantine si no pueden).
 */
export class IngestEventDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  idempotency_key!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  event_type!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  aggregate_type!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  aggregate_id!: string;

  @IsObject()
  payload!: Record<string, unknown>;

  @IsString()
  @MaxLength(32)
  schema_version!: string;

  @IsString()
  @MaxLength(32)
  app_version!: string;

  @IsISO8601()
  occurred_at!: string;
}

export class IngestBatchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  node_id!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => IngestEventDto)
  events!: IngestEventDto[];
}
