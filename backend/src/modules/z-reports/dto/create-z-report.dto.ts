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
import { MONEY_COLUMN_MAX } from "../../../common/money/money-column-bounds.const";

// Cash fields are Decimal(14,2) since the Task 8 widening — bounding here
// turns an over-capacity value into a clean 400 instead of a Postgres
// overflow 500. Sourced from the shared column ceiling (see
// money-column-bounds.const.ts) rather than a hand-copied number, so this
// stays correct if the column precision changes again — this is the exact
// field the widening was for (a UZS restaurant's daily cash total).
const CASH_MAX = MONEY_COLUMN_MAX;

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
