import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum OrderItemStatus {
  PENDING = 'PENDING',
  PREPARING = 'PREPARING',
  READY = 'READY',
}

/**
 * Iter-91: the prior shape carried `orderItemId: string` in the body
 * alongside the URL `:id` param. The service used `updateDto.orderItemId`
 * which let a client POST `:id=A` with body `{ orderItemId: 'B' }` and
 * mutate item B while the URL said A — same-tenant only, but misleading
 * for audit logs and a footgun for any path-based authorization layer.
 * The URL is now the sole source of truth; the body carries only the
 * status the client wants to transition to.
 */
export class UpdateOrderItemStatusDto {
  @ApiProperty({ enum: OrderItemStatus, description: 'Order item status' })
  @IsEnum(OrderItemStatus)
  status!: OrderItemStatus;
}
