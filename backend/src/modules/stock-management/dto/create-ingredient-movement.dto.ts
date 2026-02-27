import { IsString, IsOptional, IsNumber, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IngredientMovementType } from '../../../common/constants/stock-management.enum';

export class CreateIngredientMovementDto {
  @ApiProperty({ description: 'Stock item ID' })
  @IsString()
  stockItemId: string;

  @ApiProperty({ enum: ['IN', 'OUT', 'ADJUSTMENT'], description: 'Movement type (manual)' })
  @IsEnum({ IN: 'IN', OUT: 'OUT', ADJUSTMENT: 'ADJUSTMENT' })
  type: 'IN' | 'OUT' | 'ADJUSTMENT';

  @ApiProperty({ description: 'Quantity (positive for additions, negative for deductions)' })
  @IsNumber()
  quantity: number;

  @ApiPropertyOptional({ description: 'Cost per unit at time of movement' })
  @IsNumber()
  @IsOptional()
  costPerUnit?: number;

  @ApiPropertyOptional({ description: 'Notes' })
  @IsString()
  @IsOptional()
  notes?: string;
}
