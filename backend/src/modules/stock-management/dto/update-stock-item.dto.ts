import { PartialType } from '@nestjs/swagger';
import { CreateStockItemDto } from './create-stock-item.dto';
import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateStockItemDto extends PartialType(CreateStockItemDto) {
  @ApiPropertyOptional({ description: 'Whether item is active' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
