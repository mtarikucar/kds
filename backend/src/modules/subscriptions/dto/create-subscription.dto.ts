import { IsEnum, IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { BillingCycle } from '../../../common/constants/subscription.enum';

export class CreateSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  planId: string;

  @IsEnum(BillingCycle)
  @IsNotEmpty()
  billingCycle: BillingCycle;

  @IsString()
  @IsOptional()
  paymentMethodId?: string; // For Stripe payment method

  @IsOptional()
  iyzicoPaymentDetails?: any; // For Iyzico specific payment details
}
