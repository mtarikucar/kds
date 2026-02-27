import { IsString, IsOptional, IsBoolean, IsNumber, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateStockSettingsDto {
  @ApiPropertyOptional({ description: 'Enable auto-deduction of ingredients on order' })
  @IsBoolean()
  @IsOptional()
  enableAutoDeduction?: boolean;

  @ApiPropertyOptional({ description: 'Order status that triggers deduction (e.g. PREPARING)' })
  @IsString()
  @IsOptional()
  deductOnStatus?: string;

  @ApiPropertyOptional({ description: 'Days before expiry to trigger low stock alert' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  lowStockAlertDays?: number;

  @ApiPropertyOptional({ description: 'Purchase order number prefix' })
  @IsString()
  @IsOptional()
  poNumberPrefix?: string;
}
