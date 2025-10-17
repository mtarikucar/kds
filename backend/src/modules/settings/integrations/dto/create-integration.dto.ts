import { IsString, IsBoolean, IsEnum, IsOptional, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum IntegrationType {
  PAYMENT_GATEWAY = 'PAYMENT_GATEWAY',
  POS_HARDWARE = 'POS_HARDWARE',
  THIRD_PARTY_API = 'THIRD_PARTY_API',
  DELIVERY_APP = 'DELIVERY_APP',
  ACCOUNTING = 'ACCOUNTING',
  CRM = 'CRM',
  INVENTORY = 'INVENTORY',
}

export class CreateIntegrationDto {
  @ApiProperty({ enum: IntegrationType })
  @IsEnum(IntegrationType)
  integrationType: IntegrationType;

  @ApiProperty({ example: 'stripe' })
  @IsString()
  provider: string;

  @ApiProperty({ example: 'Stripe Payment Gateway' })
  @IsString()
  name: string;

  @ApiProperty({ example: { apiKey: 'sk_test_...', webhookSecret: 'whsec_...' } })
  @IsObject()
  config: Record<string, any>;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  notes?: string;
}
