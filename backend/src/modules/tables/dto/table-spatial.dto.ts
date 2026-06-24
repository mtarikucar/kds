import { ApiProperty } from "@nestjs/swagger";
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";

export enum TableShape {
  ROUND = "ROUND",
  SQUARE = "SQUARE",
  RECT = "RECT",
}

/**
 * Optional spatial-placement fields shared by CreateTableDto / UpdateTableDto.
 * A table can be created/edited with no geometry (it lands in the editor's
 * "unplaced" tray) and positioned later via the floor-plan editor. These let
 * the table CRUD also carry geometry when the editor creates a table directly
 * onto the canvas.
 */
export class TableSpatialFieldsDto {
  @ApiProperty({
    required: false,
    nullable: true,
    description: "Owning floor zone; null = unplaced",
  })
  @IsString()
  @IsOptional()
  zoneId?: string | null;

  @ApiProperty({ required: false })
  @IsNumber()
  @Min(-2000)
  @Max(12000)
  @IsOptional()
  posX?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @Min(-2000)
  @Max(12000)
  @IsOptional()
  posY?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @Min(10)
  @Max(2000)
  @IsOptional()
  width?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @Min(10)
  @Max(2000)
  @IsOptional()
  height?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @Min(-360)
  @Max(360)
  @IsOptional()
  rotation?: number;

  @ApiProperty({ enum: TableShape, required: false })
  @IsEnum(TableShape)
  @IsOptional()
  shape?: TableShape;
}
