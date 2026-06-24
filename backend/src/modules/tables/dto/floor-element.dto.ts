import { ApiProperty, PartialType } from "@nestjs/swagger";
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsInt,
  MaxLength,
  Min,
  Max,
  IsObject,
} from "class-validator";

export enum FloorElementType {
  WALL = "WALL",
  DOOR = "DOOR",
  BAR = "BAR",
  KITCHEN = "KITCHEN",
  PLANT = "PLANT",
  DECOR = "DECOR",
  TEXT = "TEXT",
  RECT = "RECT",
}

// Coordinates/size are in the zone's logical design units; the same
// CANVAS_MAX-ish ceiling keeps a single element from being placed light-years
// off-canvas. Negatives allowed for slight off-grid bleed.
const COORD_MIN = -2_000;
const COORD_MAX = 12_000;

export class CreateFloorElementDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  zoneId: string;

  @ApiProperty({ enum: FloorElementType })
  @IsEnum(FloorElementType)
  type: FloorElementType;

  @ApiProperty({ required: false, default: 0 })
  @IsNumber()
  @Min(COORD_MIN)
  @Max(COORD_MAX)
  @IsOptional()
  x?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsNumber()
  @Min(COORD_MIN)
  @Max(COORD_MAX)
  @IsOptional()
  y?: number;

  @ApiProperty({ required: false, default: 100 })
  @IsNumber()
  @Min(1)
  @Max(COORD_MAX)
  @IsOptional()
  width?: number;

  @ApiProperty({ required: false, default: 100 })
  @IsNumber()
  @Min(1)
  @Max(COORD_MAX)
  @IsOptional()
  height?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsNumber()
  @Min(-360)
  @Max(360)
  @IsOptional()
  rotation?: number;

  // points (polyline walls) and style are free-form JSON validated as
  // objects/arrays only; the renderer owns their shape. Kept permissive so
  // the editor can evolve element styling without a migration.
  @ApiProperty({ required: false, type: "array", items: { type: "object" } })
  @IsOptional()
  points?: any;

  @ApiProperty({ required: false, type: "object" })
  @IsObject()
  @IsOptional()
  style?: Record<string, any>;

  @ApiProperty({ required: false })
  @IsString()
  @MaxLength(280)
  @IsOptional()
  label?: string;

  @ApiProperty({ required: false, default: 0 })
  @IsInt()
  @Min(-1000)
  @Max(1000)
  @IsOptional()
  zIndex?: number;
}

export class UpdateFloorElementDto extends PartialType(CreateFloorElementDto) {}
