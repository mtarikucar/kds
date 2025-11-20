import { IsString, IsNumber, IsOptional, IsEnum, Min } from 'class-validator';

export enum PaymentProvider {
  STRIPE = 'STRIPE',
  IYZICO = 'IYZICO',
}

/**
 * DTO for creating a customer payment intent
 */
export class CreateCustomerPaymentDto {
  @IsString()
  orderId: string;

  @IsString()
  sessionId: string;

  @IsEnum(PaymentProvider)
  provider: PaymentProvider;

  @IsNumber()
  @Min(0)
  @IsOptional()
  tipAmount?: number; // Optional tip amount

  @IsString()
  @IsOptional()
  returnUrl?: string; // URL to redirect after payment

  @IsString()
  @IsOptional()
  cancelUrl?: string; // URL to redirect if payment cancelled
}

/**
 * DTO for confirming a customer payment
 */
export class ConfirmCustomerPaymentDto {
  @IsString()
  paymentIntentId: string;

  @IsString()
  @IsOptional()
  paymentMethodId?: string; // For Stripe

  @IsString()
  @IsOptional()
  conversationId?: string; // For Iyzico
}

/**
 * Response DTO for payment intent creation
 */
export interface CustomerPaymentIntentResponse {
  paymentIntentId: string;
  clientSecret: string;
  amount: number;
  currency: string;
  provider: PaymentProvider;
  orderId: string;
  status: string;

  // Provider-specific
  publishableKey?: string; // Stripe
  checkoutFormContent?: string; // Iyzico
}

/**
 * Response DTO for payment confirmation
 */
export interface CustomerPaymentConfirmationResponse {
  success: boolean;
  orderId: string;
  paymentId: string;
  receiptUrl?: string;
  message: string;
}
