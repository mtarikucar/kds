import { IsString, IsOptional, IsEnum, IsArray, ValidateNested, IsNumber, IsInt, Min, Max, ArrayMinSize, ArrayMaxSize, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderType } from '../../../common/constants/order-status.enum';

export class OrderItemModifierDto {
  @ApiProperty({ description: 'Modifier ID' })
  @IsString()
  modifierId: string;

  @ApiProperty({ description: 'Quantity of modifier', minimum: 1, maximum: 20, default: 1 })
  @IsInt()
  @Min(1)
  @Max(20)
  quantity: number;
}

export class CreateOrderItemDto {
  @ApiProperty({ description: 'Product ID' })
  @IsString()
  productId: string;

  @ApiProperty({ description: 'Quantity', minimum: 1, maximum: 9999 })
  @IsNumber()
  @Min(1)
  @Max(9999)
  quantity: number;

  @ApiPropertyOptional({ description: 'Special notes for this item' })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ type: [OrderItemModifierDto], description: 'Selected modifiers for this item' })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OrderItemModifierDto)
  @IsOptional()
  modifiers?: OrderItemModifierDto[];
}

export class CreateOrderDto {
  @ApiProperty({ enum: OrderType, description: 'Order type' })
  @IsEnum(OrderType)
  type: OrderType;

  @ApiPropertyOptional({ description: 'Table ID for dine-in orders' })
  @IsString()
  @IsOptional()
  tableId?: string;

  @ApiPropertyOptional({ description: 'Customer name' })
  @IsString()
  @IsOptional()
  customerName?: string;

  @ApiPropertyOptional({ description: 'Order notes' })
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ description: 'Discount amount', minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  discount?: number;

  @ApiProperty({ type: [CreateOrderItemDto], description: 'Order items' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
}
