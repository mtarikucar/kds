import { IsEnum, IsNotEmpty, IsString, IsOptional, IsNumber, IsObject } from 'class-validator';
import { BillingCycle, PaymentProvider } from '../../../common/constants/subscription.enum';

export class CreatePaymentIntentDto {
  @IsString()
  @IsNotEmpty()
  planId: string;

  @IsEnum(BillingCycle)
  @IsNotEmpty()
  billingCycle: BillingCycle;

  @IsEnum(PaymentProvider)
  @IsNotEmpty()
  paymentProvider: PaymentProvider;
}

export class ConfirmPaymentDto {
  @IsString()
  @IsOptional()
  paymentIntentId?: string; // Required for Stripe, not used for Iyzico

  @IsString()
  @IsOptional()
  paymentMethodId?: string; // For Stripe

  @IsObject()
  @IsOptional()
  iyzicoDetails?: {
    cardHolderName: string;
    cardNumber: string;
    expireMonth: string;
    expireYear: string;
    cvc: string;
  };
}
