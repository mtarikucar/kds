import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsOptional,
  IsInt,
  Min,
  IsNumber,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderType } from '../../../common/constants/order-status.enum';

export class OrderItemModifierDto {
  @ApiProperty({ example: 'uuid-of-modifier' })
  @IsString()
  @IsNotEmpty()
  modifierId: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({ example: 5.00 })
  @IsNumber({ maxDecimalPlaces: 2 })
  priceAdjustment: number;
}

export class CreateOrderItemDto {
  @ApiProperty({ example: 'uuid-of-product' })
  @IsString()
  @IsNotEmpty()
  productId: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({ example: 'No onions, extra sauce', required: false })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ type: [OrderItemModifierDto], required: false })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemModifierDto)
  @IsOptional()
  modifiers?: OrderItemModifierDto[];
}

export class CreateCustomerOrderDto {
  @ApiProperty({ example: 'uuid-of-tenant' })
  @IsString()
  @IsNotEmpty()
  tenantId: string;

  @ApiPropertyOptional({ example: 'uuid-of-table', description: 'Optional for COUNTER orders (tableless mode)' })
  @IsString()
  @IsOptional()
  tableId?: string;

  @ApiPropertyOptional({ enum: OrderType, example: OrderType.DINE_IN, description: 'Order type - defaults to DINE_IN if tableId provided, COUNTER if tableless' })
  @IsEnum(OrderType)
  @IsOptional()
  type?: OrderType;

  @ApiProperty({ example: 'uuid-session-id' })
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @ApiProperty({ example: '+905551234567', required: false })
  @IsString()
  @IsOptional()
  customerPhone?: string;

  @ApiProperty({ type: [CreateOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @ApiProperty({ example: 'Please bring extra napkins', required: false })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ example: 40.7128, description: 'Customer latitude for location validation' })
  @IsNumber()
  @IsOptional()
  latitude?: number;

  @ApiPropertyOptional({ example: -74.0060, description: 'Customer longitude for location validation' })
  @IsNumber()
  @IsOptional()
  longitude?: number;
}
