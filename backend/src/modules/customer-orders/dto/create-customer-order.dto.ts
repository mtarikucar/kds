import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsOptional,
  IsInt,
  IsUUID,
  Min,
  Max,
  IsNumber,
  IsEnum,
  Length,
  MaxLength,
  Matches,
  ArrayMinSize,
  ArrayMaxSize,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { OrderType } from "../../../common/constants/order-status.enum";
import {
  EmptyStringToNumber,
  EmptyStringToUndefined,
} from "../../../common/dto/transforms";

const PHONE_REGEX = /^\+?[1-9]\d{7,14}$/;

// Iter-85: customer-session token shape — 32 random bytes encoded as
// hex = exactly 64 lower-hex chars (see customer-session.service.ts
// createSession). The previous @Length(32, 128) slot accepted any
// 32-128 char string and let malformed sessionIds through to the DB
// lookup. Tight regex stops typos / spoof attempts at the DTO layer.
const SESSION_ID_REGEX = /^[0-9a-f]{64}$/;

export class OrderItemModifierDto {
  @ApiProperty({ example: "uuid-of-modifier" })
  @IsUUID()
  modifierId: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  @Max(20)
  quantity: number;
}

export class CreateOrderItemDto {
  @ApiProperty({ example: "uuid-of-product" })
  @IsUUID()
  productId: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  // Per-line cap. A legitimate order never orders 100 of one item; an
  // attacker otherwise drives INT overflow / massive subtotal computation
  // on a single line with a single request.
  @Max(99)
  quantity: number;

  @ApiProperty({ example: "No onions, extra sauce", required: false })
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
  @ApiPropertyOptional({
    example: "uuid-of-table",
    description: "Optional for COUNTER orders (tableless mode)",
  })
  @IsOptional()
  @IsUUID()
  tableId?: string;

  @ApiPropertyOptional({ enum: OrderType })
  @IsEnum(OrderType)
  @IsOptional()
  type?: OrderType;

  @ApiProperty()
  @IsString()
  @Length(64, 64)
  @Matches(SESSION_ID_REGEX, {
    message: "sessionId must be a 64-char lower-hex string",
  })
  sessionId: string;

  @ApiProperty({ required: false })
  @EmptyStringToUndefined()
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

  // Geographic range bounds — a value outside [-90, 90] for latitude
  // (or [-180, 180] for longitude) is mathematically impossible and
  // would skew the haversine distance calc in
  // isLocationWithinRange. Without the @Min/@Max a malicious client
  // posting `latitude: 1e30` flows into the geo math and produces
  // either NaN distance (passes the range check by accident) or
  // garbage values the comparison treats as "far". Same iter-42
  // shape: cap the input before downstream code reads it.
  @ApiPropertyOptional()
  @EmptyStringToNumber()
  @IsNumber()
  @IsOptional()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional()
  @EmptyStringToNumber()
  @IsNumber()
  @IsOptional()
  @Min(-180)
  @Max(180)
  longitude?: number;
}
