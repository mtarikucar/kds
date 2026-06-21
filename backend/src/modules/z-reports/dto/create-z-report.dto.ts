import {
  IsNotEmpty,
  IsNumber,
  IsString,
  IsOptional,
  IsDateString,
  Min,
  Max,
  MaxLength,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

// Cash fields are Decimal(10,2) — max 99 999 999.99. Bounding here turns an
// over-capacity value into a clean 400 instead of a Postgres overflow 500.
const CASH_MAX = 99_999_999.99;

export class CreateZReportDto {
  @ApiProperty({ description: "Date of the report (YYYY-MM-DD)" })
  @IsNotEmpty()
  @IsDateString()
  reportDate: string;

  @ApiProperty({ description: "Cash drawer opening balance" })
  @IsNotEmpty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(CASH_MAX)
  cashDrawerOpening: number;

  @ApiProperty({ description: "Cash drawer closing balance (counted)" })
  @IsNotEmpty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(CASH_MAX)
  cashDrawerClosing: number;

  @ApiProperty({
    description: "Optional notes for the report",
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
