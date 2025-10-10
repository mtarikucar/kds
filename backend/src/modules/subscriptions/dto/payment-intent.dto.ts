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
  @IsNotEmpty()
  paymentIntentId: string;

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
