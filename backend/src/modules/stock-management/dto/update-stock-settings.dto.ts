import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsEnum,
  MaxLength,
  Matches,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '../../../common/constants/order-status.enum';

export class UpdateStockSettingsDto {
  @ApiPropertyOptional({ description: 'Enable auto-deduction of ingredients on order' })
  @IsBoolean()
  @IsOptional()
  enableAutoDeduction?: boolean;

  @ApiPropertyOptional({
    description: 'Order status that triggers deduction',
    enum: OrderStatus,
  })
  @IsEnum(OrderStatus)
  @IsOptional()
  deductOnStatus?: OrderStatus;

  @ApiPropertyOptional({ description: 'Days before expiry to trigger low stock alert' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  lowStockAlertDays?: number;

  @ApiPropertyOptional({ description: 'Purchase order number prefix (letters/digits/-, 1-10 chars)' })
  @IsString()
  @IsOptional()
  @MaxLength(10)
  @Matches(/^[A-Za-z0-9-]{1,10}$/)
  poNumberPrefix?: string;

  @ApiPropertyOptional({
    description:
      'Allow deductions that would drive stock negative. When false (default) shortages raise a conflict instead of silently masking.',
  })
  @IsBoolean()
  @IsOptional()
  allowNegativeStock?: boolean;
}
