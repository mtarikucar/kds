import { Injectable } from '@nestjs/common';
import { PaymentProvider, PaymentRegion } from '../../../common/constants/subscription.enum';
import { PaytrService } from './paytr.service';

export interface IPaymentProvider {
  createPaymentLink?(...args: any[]): Promise<any>;
  createPayment?(...args: any[]): Promise<any>;
  verifyCallback?(...args: any[]): boolean;
}

@Injectable()
export class PaymentProviderFactory {
  constructor(
    private readonly paytrService: PaytrService,
  ) {}

  /**
   * Get the appropriate payment provider based on region
   * For Turkey: PayTR
   * For International: Email-based (no payment provider)
   */
  getProvider(region: PaymentRegion): IPaymentProvider | null {
    if (region === PaymentRegion.TURKEY) {
      return this.paytrService;
    }
    // International customers use email-based flow, no payment provider
    return null;
  }

  /**
   * Get payment provider enum based on region
   * For Turkey: PayTR
   * For International: EMAIL (manual process)
   */
  getProviderType(region: PaymentRegion): PaymentProvider {
    if (region === PaymentRegion.TURKEY) {
      return PaymentProvider.PAYTR;
    }
    // International customers use email-based manual process
    return PaymentProvider.EMAIL;
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
   * Get PayTR service directly (for PayTR-specific operations)
   */
  getPaytrService(): PaytrService {
    return this.paytrService;
  }
}
