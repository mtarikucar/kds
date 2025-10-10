import { Injectable } from '@nestjs/common';
import { PaymentProvider, PaymentRegion } from '../../../common/constants/subscription.enum';
import { StripeService } from './stripe.service';
import { IyzicoService } from './iyzico.service';

export interface IPaymentProvider {
  createPayment(...args: any[]): Promise<any>;
  createSubscription?(...args: any[]): Promise<any>;
  cancelSubscription?(...args: any[]): Promise<any>;
  refundPayment?(...args: any[]): Promise<any>;
}

@Injectable()
export class PaymentProviderFactory {
  constructor(
    private readonly stripeService: StripeService,
    private readonly iyzicoService: IyzicoService,
  ) {}

  /**
   * Get the appropriate payment provider based on region
   */
  getProvider(region: PaymentRegion): IPaymentProvider {
    if (region === PaymentRegion.TURKEY) {
      return this.iyzicoService;
    }
    return this.stripeService;
  }

  /**
   * Get payment provider enum based on region
   */
  getProviderType(region: PaymentRegion): PaymentProvider {
    if (region === PaymentRegion.TURKEY) {
      return PaymentProvider.IYZICO;
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
   * Get Iyzico service directly (for Iyzico-specific operations)
   */
  getIyzicoService(): IyzicoService {
    return this.iyzicoService;
  }
}
