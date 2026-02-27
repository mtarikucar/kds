import { IsString, IsOptional, IsArray } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStockCountDto {
  @ApiPropertyOptional({ description: 'Count session name' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'Notes' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ description: 'Stock item IDs to include (empty = all active items)' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  stockItemIds?: string[];
}
