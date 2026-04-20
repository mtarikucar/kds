import { IsNumber, IsEnum, IsString, IsOptional, Min, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '../../../common/constants/order-status.enum';

export class CreatePaymentDto {
  @ApiProperty({ description: 'Payment amount', minimum: 0.01 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ enum: PaymentMethod, description: 'Payment method' })
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @ApiPropertyOptional({ description: 'Payment notes' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ description: 'External gateway transaction identifier' })
  @IsString()
  @IsOptional()
  @Length(1, 128)
  transactionId?: string;

  @ApiPropertyOptional({
    description:
      'Client-generated idempotency key. Retries sharing the same (orderId, idempotencyKey) return the existing payment instead of creating a duplicate.',
  })
  @IsString()
  @IsOptional()
  @Length(8, 64)
  idempotencyKey?: string;

  @ApiPropertyOptional({ description: 'Customer phone for linking to customer record' })
  @IsString()
  @IsOptional()
  customerPhone?: string;
}
