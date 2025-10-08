import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '../../../common/constants/order-status.enum';

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus, description: 'Order status' })
  @IsEnum(OrderStatus)
  status: OrderStatus;
}
