import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  Min,
  Max,
  MaxLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { StockUnit } from "../../../common/constants/stock-management.enum";

// Match the StockItem column precision: currentStock/minStock Decimal(10,3),
// costPerUnit Decimal(10,4). Without an upper bound an oversized number
// overflows Postgres and 500s instead of returning a clean 400.
const QTY_MAX = 9_999_999.999;
const COST_MAX = 999_999.9999;

export class CreateStockItemDto {
  @ApiProperty({ description: "Item name" })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ description: "SKU code" })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  sku?: string;

  @ApiProperty({ enum: StockUnit, description: "Unit of measurement" })
  @IsEnum(StockUnit)
  unit: StockUnit;

  @ApiPropertyOptional({ description: "Item description" })
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: "Current stock quantity", minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(QTY_MAX)
  @IsOptional()
  currentStock?: number;

  @ApiPropertyOptional({ description: "Minimum stock threshold", minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(QTY_MAX)
  @IsOptional()
  minStock?: number;

  @ApiPropertyOptional({
    description: "Fixed quantity to suggest ordering at reorder point",
    minimum: 0,
  })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(QTY_MAX)
  @IsOptional()
  reorderQuantity?: number;

  @ApiPropertyOptional({ description: "Cost per unit", minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(COST_MAX)
  @IsOptional()
  costPerUnit?: number;

  @ApiPropertyOptional({ description: "Track expiry dates" })
  @IsBoolean()
  @IsOptional()
  trackExpiry?: boolean;

  @ApiPropertyOptional({ description: "Category ID" })
  @IsString()
  @IsOptional()
  categoryId?: string;
}
