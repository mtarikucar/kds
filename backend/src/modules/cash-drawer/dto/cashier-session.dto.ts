import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class OpenCashierSessionDto {
  @ApiProperty({ description: "Opening cash float", minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  openingFloat: number;

  @ApiPropertyOptional({
    description: "Cashier user id (defaults to the calling user)",
  })
  @IsString()
  @IsOptional()
  userId?: string;
}

export class CloseCashierSessionDto {
  @ApiPropertyOptional({
    description:
      "Counted cash total. Ignored when denominationBreakdown is supplied (the count is derived from it).",
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  @IsOptional()
  countedCash?: number;

  @ApiPropertyOptional({
    description: 'Physical denomination count, e.g. {"200":3,"100":5,"50":2}',
  })
  @IsObject()
  @IsOptional()
  denominationBreakdown?: Record<string, number>;

  @ApiPropertyOptional({ description: "Close notes" })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}
