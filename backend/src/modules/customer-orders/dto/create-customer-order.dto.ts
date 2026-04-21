import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsNumber,
  IsEnum,
  Length,
  MaxLength,
  Matches,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderType } from '../../../common/constants/order-status.enum';

const PHONE_REGEX = /^\+?[1-9]\d{7,14}$/;

export class OrderItemModifierDto {
  @ApiProperty({ example: 'uuid-of-modifier' })
  @IsString()
  @IsNotEmpty()
  modifierId: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  @Max(20)
  quantity: number;
}

export class CreateOrderItemDto {
  @ApiProperty({ example: 'uuid-of-product' })
  @IsString()
  @IsNotEmpty()
  productId: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  // Per-line cap. A legitimate order never orders 100 of one item; an
  // attacker otherwise drives INT overflow / massive subtotal computation
  // on a single line with a single request.
  @Max(99)
  quantity: number;

  @ApiProperty({ example: 'No onions, extra sauce', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({ type: [OrderItemModifierDto], required: false })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OrderItemModifierDto)
  @IsOptional()
  modifiers?: OrderItemModifierDto[];
}

export class CreateCustomerOrderDto {
  @ApiPropertyOptional({ example: 'uuid-of-table', description: 'Optional for COUNTER orders (tableless mode)' })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  tableId?: string;

  @ApiPropertyOptional({ enum: OrderType })
  @IsEnum(OrderType)
  @IsOptional()
  type?: OrderType;

  @ApiProperty()
  @IsString()
  @Length(32, 128)
  sessionId: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  @Matches(PHONE_REGEX)
  customerPhone?: string;

  @ApiProperty({ type: [CreateOrderItemDto] })
  @IsArray()
  // A customer order can realistically span a dozen dishes, not a hundred.
  // Without these sizes, a public QR endpoint becomes a cheap DoS vector.
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  latitude?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  longitude?: number;
}
