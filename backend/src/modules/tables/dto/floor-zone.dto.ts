import { ApiProperty, PartialType } from "@nestjs/swagger";
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsEnum,
  IsNumber,
  IsUrl,
  Max,
  Min,
  MaxLength,
  ValidateNested,
  IsArray,
  ArrayMaxSize,
} from "class-validator";
import { Type } from "class-transformer";

export enum FloorZoneKind {
  INDOOR = "INDOOR",
  OUTDOOR = "OUTDOOR",
}

// Canvas bounds are generous but capped: a logical design surface, not a
// pixel buffer. 10k×10k design units covers any real venue while stopping a
// client from stamping an absurd value the editor would choke rendering.
const CANVAS_MIN = 200;
const CANVAS_MAX = 10_000;

export class CreateFloorZoneDto {
  @ApiProperty({ example: "Kat 1" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;

  @ApiProperty({ enum: FloorZoneKind, required: false, default: "INDOOR" })
  @IsEnum(FloorZoneKind)
  @IsOptional()
  kind?: FloorZoneKind;

  @ApiProperty({ required: false, default: 1200 })
  @IsInt()
  @Min(CANVAS_MIN)
  @Max(CANVAS_MAX)
  @IsOptional()
  canvasWidth?: number;

  @ApiProperty({ required: false, default: 800 })
  @IsInt()
  @Min(CANVAS_MIN)
  @Max(CANVAS_MAX)
  @IsOptional()
  canvasHeight?: number;

  @ApiProperty({ required: false, default: 20 })
  @IsInt()
  @Min(2)
  @Max(200)
  @IsOptional()
  gridSize?: number;

  @ApiProperty({ required: false })
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  @IsOptional()
  backgroundImageUrl?: string;

  @ApiProperty({ required: false, default: 1 })
  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  backgroundOpacity?: number;
}

export class UpdateFloorZoneDto extends PartialType(CreateFloorZoneDto) {}

class ReorderZoneItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder: number;
}

export class ReorderZonesDto {
  @ApiProperty({ type: [ReorderZoneItemDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReorderZoneItemDto)
  zones: ReorderZoneItemDto[];
}
