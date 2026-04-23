import { IsNumber, IsEnum, IsString, IsOptional, Min, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '../../../common/constants/order-status.enum';
import { EmptyStringToUndefined } from '../../../common/dto/transforms';

export class CreatePaymentDto {
  @ApiProperty({ description: 'Payment amount', minimum: 0.01 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ enum: PaymentMethod, description: 'Payment method' })
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @ApiPropertyOptional({ description: 'Payment notes' })
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ description: 'External gateway transaction identifier' })
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  @Length(1, 128)
  transactionId?: string;

  @ApiPropertyOptional({
    description:
      'Client-generated idempotency key. Retries sharing the same (orderId, idempotencyKey) return the existing payment instead of creating a duplicate.',
  })
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  @Length(8, 64)
  idempotencyKey?: string;

  @ApiPropertyOptional({ description: 'Customer phone for linking to customer record' })
  @EmptyStringToUndefined()
  @IsString()
  @IsOptional()
  customerPhone?: string;
}
