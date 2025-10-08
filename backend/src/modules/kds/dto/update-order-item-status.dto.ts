import { IsString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum OrderItemStatus {
  PENDING = 'PENDING',
  PREPARING = 'PREPARING',
  READY = 'READY',
}

export class UpdateOrderItemStatusDto {
  @ApiProperty({ description: 'Order item ID' })
  @IsString()
  orderItemId: string;

  @ApiProperty({ enum: OrderItemStatus, description: 'Order item status' })
  @IsEnum(OrderItemStatus)
  status: OrderItemStatus;
}
