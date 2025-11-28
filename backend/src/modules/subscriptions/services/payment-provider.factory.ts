import { Injectable } from '@nestjs/common';
import { PaymentProvider, PaymentRegion } from '../../../common/constants/subscription.enum';
import { StripeService } from './stripe.service';
import { PaytrService } from './paytr.service';

export interface IPaymentProvider {
  createPaymentLink?(...args: any[]): Promise<any>;
  createPayment?(...args: any[]): Promise<any>;
  verifyCallback?(...args: any[]): boolean;
}

@Injectable()
export class PaymentProviderFactory {
  constructor(
    private readonly stripeService: StripeService,
    private readonly paytrService: PaytrService,
  ) {}

  /**
   * Get the appropriate payment provider based on region
   */
  getProvider(region: PaymentRegion): IPaymentProvider {
    if (region === PaymentRegion.TURKEY) {
      return this.paytrService;
    }
    return this.stripeService;
  }

  /**
   * Get payment provider enum based on region
   */
  getProviderType(region: PaymentRegion): PaymentProvider {
    if (region === PaymentRegion.TURKEY) {
      return PaymentProvider.PAYTR;
    }
    return PaymentProvider.STRIPE;
  }

  /**
   * Determine region based on country code or other factors
   */
  determineRegion(countryCode?: string): PaymentRegion {
    // Check if country is Turkey
    if (countryCode?.toUpperCase() === 'TR' || countryCode?.toUpperCase() === 'TUR') {
      return PaymentRegion.TURKEY;
    }
    return PaymentRegion.INTERNATIONAL;
  }

  /**
   * Get Stripe service directly (for Stripe-specific operations)
   */
  getStripeService(): StripeService {
    return this.stripeService;
  }

  /**
   * Get PayTR service directly (for PayTR-specific operations)
   */
  getPaytrService(): PaytrService {
    return this.paytrService;
  }
}
