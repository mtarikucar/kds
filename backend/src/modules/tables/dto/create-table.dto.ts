import { ApiProperty } from "@nestjs/swagger";
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Max,
  MaxLength,
  Min,
  IsEnum,
} from "class-validator";
import { TableSpatialFieldsDto } from "./table-spatial.dto";

export enum TableStatus {
  AVAILABLE = "AVAILABLE",
  OCCUPIED = "OCCUPIED",
  RESERVED = "RESERVED",
}

// Extends the optional floor-plan geometry (zoneId/posX/posY/width/height/
// rotation/shape) so a table may be created directly onto the canvas; all
// geometry fields are optional and default in the DB when omitted.
export class CreateTableDto extends TableSpatialFieldsDto {
  // Caps protect Table.number / Table.section (Postgres TEXT — no implicit
  // ceiling) and the @@unique(tenantId, number) constraint from accepting
  // a multi-MB blob as the canonical id of a physical table. Realistic
  // restaurant numbering schemes never exceed 16 chars ("Patio-12-A").
  @ApiProperty({ example: "1" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  number: string;

  // Capacity is the number of seats — 200 is generous for banquet halls
  // and well above any realistic single-table footprint. Without a cap a
  // misconfigured client can stamp 1e10 onto a row that downstream
  // capacity-planning code (reservation guest count vs table capacity)
  // would treat as effectively-infinite seating.
  @ApiProperty({ example: 4 })
  @IsInt()
  @Min(1)
  @Max(200)
  capacity: number;

  @ApiProperty({ example: "Main Hall", required: false })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  section?: string;

  @ApiProperty({
    enum: TableStatus,
    example: TableStatus.AVAILABLE,
    default: TableStatus.AVAILABLE,
  })
  @IsEnum(TableStatus)
  @IsOptional()
  status?: TableStatus;
}
