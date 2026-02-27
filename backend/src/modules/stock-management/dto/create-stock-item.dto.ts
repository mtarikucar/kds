import { IsString, IsOptional, IsEnum, IsNumber, IsBoolean, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StockUnit } from '../../../common/constants/stock-management.enum';

export class CreateStockItemDto {
  @ApiProperty({ description: 'Item name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'SKU code' })
  @IsString()
  @IsOptional()
  sku?: string;

  @ApiProperty({ enum: StockUnit, description: 'Unit of measurement' })
  @IsEnum(StockUnit)
  unit: StockUnit;

  @ApiPropertyOptional({ description: 'Item description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Current stock quantity', minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  currentStock?: number;

  @ApiPropertyOptional({ description: 'Minimum stock threshold', minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  minStock?: number;

  @ApiPropertyOptional({ description: 'Cost per unit', minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  costPerUnit?: number;

  @ApiPropertyOptional({ description: 'Track expiry dates' })
  @IsBoolean()
  @IsOptional()
  trackExpiry?: boolean;

  @ApiPropertyOptional({ description: 'Category ID' })
  @IsString()
  @IsOptional()
  categoryId?: string;
}
