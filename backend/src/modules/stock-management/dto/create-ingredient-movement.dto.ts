import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  Min,
  Max,
  MaxLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

// StockItem.currentStock is Decimal(10,3) (max 9 999 999.999); costPerUnit is
// Decimal(10,4) (max 999 999.9999). Bound the inputs to the column precision so
// an oversized value fails with a clean 400 instead of a Postgres overflow 500.
const QTY_MAX = 9_999_999.999;
const COST_MAX = 999_999.9999;

export class CreateIngredientMovementDto {
  @ApiProperty({ description: "Stock item ID" })
  @IsString()
  stockItemId: string;

  @ApiProperty({
    enum: ["IN", "OUT", "ADJUSTMENT"],
    description: "Movement type (manual)",
  })
  @IsEnum({ IN: "IN", OUT: "OUT", ADJUSTMENT: "ADJUSTMENT" })
  type: "IN" | "OUT" | "ADJUSTMENT";

  @ApiProperty({
    description: "Quantity (positive for additions, negative for deductions)",
  })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(-QTY_MAX)
  @Max(QTY_MAX)
  quantity: number;

  @ApiPropertyOptional({ description: "Cost per unit at time of movement" })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(COST_MAX)
  @IsOptional()
  costPerUnit?: number;

  @ApiPropertyOptional({ description: "Notes" })
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  notes?: string;
}
