import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class CreateCashDrawerMovementDto {
  @ApiProperty({
    description: "Movement type",
    enum: ["OPENING", "CLOSING", "CASH_IN", "CASH_OUT", "ADJUSTMENT"],
  })
  @IsIn(["OPENING", "CLOSING", "CASH_IN", "CASH_OUT", "ADJUSTMENT"])
  type: string;

  @ApiProperty({
    description: "Movement amount in tenant currency",
    example: 250.0,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10_000_000)
  amount: number;

  @ApiPropertyOptional({ description: "Short reason / category code" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @ApiPropertyOptional({ description: "Free-form notes (audit log)" })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    description: "Cash denomination counting breakdown (for CLOSING type)",
    example: { 100: 5, 50: 10, 20: 15 },
  })
  @IsOptional()
  @IsObject()
  denominationBreakdown?: Record<string, number>;

  @ApiPropertyOptional({ description: "Associated Z-Report (CLOSING)" })
  @IsOptional()
  @IsUUID()
  zReportId?: string;
}
