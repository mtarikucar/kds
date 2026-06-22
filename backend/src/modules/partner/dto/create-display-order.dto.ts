import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { OrderType } from "../../../common/constants/order-status.enum";
import { CreateOrderItemDto } from "../../customer-orders/dto/create-customer-order.dto";

/**
 * Body for POST /v1/display/orders. Carries NO sessionId / tableId / coords —
 * the server supplies those from the authenticated screen token
 * (req.screen.orderingSessionId / tableId, plus the venue's tenant coords for
 * the geofence). Item validation is the SAME shape as the QR-menu path
 * (CreateOrderItemDto reused verbatim).
 */
export class CreateDisplayOrderDto {
  @ApiProperty({ type: [CreateOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @ApiPropertyOptional({ enum: OrderType })
  @IsEnum(OrderType)
  @IsOptional()
  type?: OrderType;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}
