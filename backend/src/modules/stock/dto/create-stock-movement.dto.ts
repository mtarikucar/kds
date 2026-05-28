import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StockMovementType } from '../../../common/constants/order-status.enum';

export class CreateStockMovementDto {
  @ApiProperty({ description: 'Product ID' })
  @IsUUID()
  productId: string;

  @ApiProperty({ enum: StockMovementType, description: 'Stock movement type' })
  @IsEnum(StockMovementType)
  type: StockMovementType;

  // Product.currentStock is Postgres int4 — max 2,147,483,647. The cap
  // here is well below that ceiling so a bug-driven IN movement of 1e10
  // doesn't surface as a 500 from a numeric_overflow, and the
  // computed-running-stock math (multi-row movements summed elsewhere)
  // doesn't overflow either. Switched to @IsInt so fractional units
  // (which downstream count-based math would silently truncate) get
  // rejected at the boundary.
  @ApiProperty({ description: 'Quantity', minimum: 1, maximum: 1_000_000 })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity: number;

  @ApiPropertyOptional({ description: 'Reason for stock movement' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  reason?: string;

  @ApiPropertyOptional({ description: 'Additional notes' })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;
}
