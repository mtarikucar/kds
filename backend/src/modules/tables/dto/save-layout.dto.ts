import { ApiProperty } from "@nestjs/swagger";
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
  Min,
  Max,
  IsObject,
} from "class-validator";
import { Type } from "class-transformer";
import { TableShape } from "./table-spatial.dto";

const COORD_MIN = -2_000;
const COORD_MAX = 12_000;

// One placed table's geometry in a bulk save. zoneId null = move back to the
// unplaced tray. Only geometry + zone here — table number/capacity/status are
// owned by the table CRUD endpoints, never overwritten by a layout drag.
export class LayoutTableItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ required: false, nullable: true })
  @IsString()
  @IsOptional()
  zoneId?: string | null;

  @ApiProperty()
  @IsNumber()
  @Min(COORD_MIN)
  @Max(COORD_MAX)
  posX: number;

  @ApiProperty()
  @IsNumber()
  @Min(COORD_MIN)
  @Max(COORD_MAX)
  posY: number;

  @ApiProperty()
  @IsNumber()
  @Min(10)
  @Max(2000)
  width: number;

  @ApiProperty()
  @IsNumber()
  @Min(10)
  @Max(2000)
  height: number;

  @ApiProperty()
  @IsNumber()
  @Min(-360)
  @Max(360)
  rotation: number;

  @ApiProperty({ enum: TableShape })
  @IsEnum(TableShape)
  shape: TableShape;
}

// One placed element's geometry in a bulk save (existing elements only —
// creating/deleting elements goes through the element CRUD endpoints).
export class LayoutElementItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty()
  @IsNumber()
  @Min(COORD_MIN)
  @Max(COORD_MAX)
  x: number;

  @ApiProperty()
  @IsNumber()
  @Min(COORD_MIN)
  @Max(COORD_MAX)
  y: number;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  @Max(COORD_MAX)
  width: number;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  @Max(COORD_MAX)
  height: number;

  @ApiProperty()
  @IsNumber()
  @Min(-360)
  @Max(360)
  rotation: number;

  @ApiProperty({ required: false })
  @IsOptional()
  points?: any;

  @ApiProperty({ required: false, type: "object" })
  @IsObject()
  @IsOptional()
  style?: Record<string, any>;
}

// Persist a whole drag/resize session in one transactional call. Caps keep a
// single request from rewriting an unbounded number of rows.
export class SaveLayoutDto {
  @ApiProperty({ type: [LayoutTableItemDto] })
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => LayoutTableItemDto)
  tables: LayoutTableItemDto[];

  @ApiProperty({ type: [LayoutElementItemDto], required: false })
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => LayoutElementItemDto)
  @IsOptional()
  elements?: LayoutElementItemDto[];
}
