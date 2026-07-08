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
    description:
      "Movement type. SAFE_DROP / BANK_DEPOSIT / PETTY_CASH remove cash from the drawer (counted as cash-out at reconciliation).",
    enum: [
      "OPENING",
      "CLOSING",
      "CASH_IN",
      "CASH_OUT",
      "ADJUSTMENT",
      "SAFE_DROP",
      "BANK_DEPOSIT",
      "PETTY_CASH",
    ],
  })
  @IsIn([
    "OPENING",
    "CLOSING",
    "CASH_IN",
    "CASH_OUT",
    "ADJUSTMENT",
    "SAFE_DROP",
    "BANK_DEPOSIT",
    "PETTY_CASH",
  ])
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
    description:
      "Per-note/coin till count as a { faceValue: count } map. When supplied, " +
      "the server enforces Σ(faceValue × count) === amount (rejects on mismatch) " +
      "so the count cannot silently disagree with the entered amount. Full " +
      "expected-vs-counted Z-Report reconciliation is not yet wired.",
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
