import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Iyzipay = require('iyzipay');

interface IyzicoCustomer {
  id: string;
  email: string;
  name: string;
  surname: string;
  identityNumber: string;
  gsmNumber: string;
  city: string;
  country: string;
  address: string;
  zipCode: string;
}

interface IyzicoPaymentCard {
  cardHolderName: string;
  cardNumber: string;
  expireMonth: string;
  expireYear: string;
  cvc: string;
}

interface IyzicoPaymentResult {
  paymentId: string;
  conversationId: string;
  status: string;
  price: number;
  paidPrice: number;
  currency: string;
  errorMessage?: string;
}

@Injectable()
export class IyzicoService {
  private readonly logger = new Logger(IyzicoService.name);
  private iyzipay: any;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('IYZICO_API_KEY');
    const secretKey = this.configService.get<string>('IYZICO_SECRET_KEY');
    const baseUrl = this.configService.get<string>('IYZICO_BASE_URL', 'https://sandbox-api.iyzipay.com');

    // Only initialize if valid credentials are provided (not placeholders)
    if (!apiKey || !secretKey || apiKey === 'placeholder' || secretKey === 'placeholder') {
      this.logger.warn('Iyzico API credentials not configured or using placeholder values. Iyzico payments will be disabled.');
    } else {
      this.iyzipay = new Iyzipay({
        apiKey,
        secretKey,
        uri: baseUrl,
      });
    }
  }

  /**
   * Create a payment for subscription
   */
  async createPayment(
    amount: number,
    currency: string,
    customer: IyzicoCustomer,
    paymentCard: IyzicoPaymentCard,
    conversationId: string,
    description: string,
    clientIp?: string,
  ): Promise<IyzicoPaymentResult> {
    if (!this.iyzipay) {
      throw new BadRequestException('Iyzico payment service is not configured');
    }

    const request = {
      locale: Iyzipay.LOCALE.TR,
      conversationId,
      price: amount.toFixed(2),
      paidPrice: amount.toFixed(2),
      currency: currency === 'USD' ? Iyzipay.CURRENCY.USD : Iyzipay.CURRENCY.TRY,
      installment: '1',
      basketId: conversationId,
      paymentChannel: Iyzipay.PAYMENT_CHANNEL.WEB,
      paymentGroup: Iyzipay.PAYMENT_GROUP.SUBSCRIPTION,
      paymentCard: {
        cardHolderName: paymentCard.cardHolderName,
        cardNumber: paymentCard.cardNumber,
        expireMonth: paymentCard.expireMonth,
        expireYear: paymentCard.expireYear,
        cvc: paymentCard.cvc,
        registerCard: '0',
      },
      buyer: {
        id: customer.id,
        name: customer.name,
        surname: customer.surname,
        gsmNumber: customer.gsmNumber,
        email: customer.email,
        identityNumber: customer.identityNumber,
        registrationAddress: customer.address,
        ip: clientIp || '127.0.0.1', // Client IP passed from controller
        city: customer.city,
        country: customer.country,
        zipCode: customer.zipCode,
      },
      shippingAddress: {
        contactName: `${customer.name} ${customer.surname}`,
        city: customer.city,
        country: customer.country,
        address: customer.address,
        zipCode: customer.zipCode,
      },
      billingAddress: {
        contactName: `${customer.name} ${customer.surname}`,
        city: customer.city,
        country: customer.country,
        address: customer.address,
        zipCode: customer.zipCode,
      },
      basketItems: [
        {
          id: 'SUBSCRIPTION',
          name: description,
          category1: 'Subscription',
          itemType: Iyzipay.BASKET_ITEM_TYPE.VIRTUAL,
          price: amount.toFixed(2),
        },
      ],
    };

    return new Promise((resolve, reject) => {
      this.iyzipay.payment.create(request, (err: any, result: any) => {
        if (err) {
          this.logger.error(`Iyzico payment error: ${JSON.stringify(err)}`);
          reject(new BadRequestException('Payment failed'));
          return;
        }

        if (result.status !== 'success') {
          this.logger.error(`Iyzico payment failed: ${result.errorMessage}`);
          resolve({
            paymentId: result.paymentId || '',
            conversationId: result.conversationId,
            status: result.status,
            price: parseFloat(result.price || '0'),
            paidPrice: parseFloat(result.paidPrice || '0'),
            currency: result.currency,
            errorMessage: result.errorMessage,
          });
          return;
        }

        resolve({
          paymentId: result.paymentId,
          conversationId: result.conversationId,
          status: result.status,
          price: parseFloat(result.price),
          paidPrice: parseFloat(result.paidPrice),
          currency: result.currency,
        });
      });
    });
  }

  /**
   * Create a subscription payment (recurring)
   */
  async createRecurringPayment(
    amount: number,
    currency: string,
    customer: IyzicoCustomer,
    paymentCard: IyzicoPaymentCard,
    conversationId: string,
    description: string,
    clientIp?: string,
  ): Promise<IyzicoPaymentResult> {
    if (!this.iyzipay) {
      throw new BadRequestException('Iyzico payment service is not configured');
    }

    // Iyzico doesn't have native subscription support like Stripe
    // We need to handle recurring payments manually using scheduled jobs
    // This method is similar to createPayment but stores card for future use

    const request = {
      locale: Iyzipay.LOCALE.TR,
      conversationId,
      price: amount.toFixed(2),
      paidPrice: amount.toFixed(2),
      currency: currency === 'USD' ? Iyzipay.CURRENCY.USD : Iyzipay.CURRENCY.TRY,
      installment: '1',
      basketId: conversationId,
      paymentChannel: Iyzipay.PAYMENT_CHANNEL.WEB,
      paymentGroup: Iyzipay.PAYMENT_GROUP.SUBSCRIPTION,
      paymentCard: {
        cardHolderName: paymentCard.cardHolderName,
        cardNumber: paymentCard.cardNumber,
        expireMonth: paymentCard.expireMonth,
        expireYear: paymentCard.expireYear,
        cvc: paymentCard.cvc,
        registerCard: '1', // Register card for future payments
      },
      buyer: {
        id: customer.id,
        name: customer.name,
        surname: customer.surname,
        gsmNumber: customer.gsmNumber,
        email: customer.email,
        identityNumber: customer.identityNumber,
        registrationAddress: customer.address,
        ip: clientIp || '127.0.0.1', // Client IP passed from controller
        city: customer.city,
        country: customer.country,
        zipCode: customer.zipCode,
      },
      shippingAddress: {
        contactName: `${customer.name} ${customer.surname}`,
        city: customer.city,
        country: customer.country,
        address: customer.address,
        zipCode: customer.zipCode,
      },
      billingAddress: {
        contactName: `${customer.name} ${customer.surname}`,
        city: customer.city,
        country: customer.country,
        address: customer.address,
        zipCode: customer.zipCode,
      },
      basketItems: [
        {
          id: 'SUBSCRIPTION',
          name: description,
          category1: 'Subscription',
          itemType: Iyzipay.BASKET_ITEM_TYPE.VIRTUAL,
          price: amount.toFixed(2),
        },
      ],
    };

    return new Promise((resolve, reject) => {
      this.iyzipay.payment.create(request, (err: any, result: any) => {
        if (err) {
          this.logger.error(`Iyzico recurring payment error: ${JSON.stringify(err)}`);
          reject(new BadRequestException('Recurring payment setup failed'));
          return;
        }

        if (result.status !== 'success') {
          this.logger.error(`Iyzico recurring payment failed: ${result.errorMessage}`);
          resolve({
            paymentId: result.paymentId || '',
            conversationId: result.conversationId,
            status: result.status,
            price: parseFloat(result.price || '0'),
            paidPrice: parseFloat(result.paidPrice || '0'),
            currency: result.currency,
            errorMessage: result.errorMessage,
          });
          return;
        }

        resolve({
          paymentId: result.paymentId,
          conversationId: result.conversationId,
          status: result.status,
          price: parseFloat(result.price),
          paidPrice: parseFloat(result.paidPrice),
          currency: result.currency,
        });
      });
    });
  }

  /**
   * Retrieve payment details
   */
  async getPayment(paymentId: string, conversationId: string): Promise<any> {
    if (!this.iyzipay) {
      throw new BadRequestException('Iyzico payment service is not configured');
    }

    const request = {
      locale: Iyzipay.LOCALE.TR,
      conversationId,
      paymentId,
    };

    return new Promise((resolve, reject) => {
      this.iyzipay.payment.retrieve(request, (err: any, result: any) => {
        if (err) {
          this.logger.error(`Failed to retrieve Iyzico payment: ${JSON.stringify(err)}`);
          reject(new BadRequestException('Failed to retrieve payment'));
          return;
        }
        resolve(result);
      });
    });
  }

  /**
   * Cancel/refund a payment
   */
  async refundPayment(paymentTransactionId: string, amount: number, conversationId: string): Promise<any> {
    if (!this.iyzipay) {
      throw new BadRequestException('Iyzico payment service is not configured');
    }

    const request = {
      locale: Iyzipay.LOCALE.TR,
      conversationId,
      paymentTransactionId,
      price: amount.toFixed(2),
      currency: Iyzipay.CURRENCY.TRY,
    };

    return new Promise((resolve, reject) => {
      this.iyzipay.refund.create(request, (err: any, result: any) => {
        if (err) {
          this.logger.error(`Failed to refund Iyzico payment: ${JSON.stringify(err)}`);
          reject(new BadRequestException('Failed to refund payment'));
          return;
        }
        resolve(result);
      });
    });
  }

  /**
   * Verify webhook callback (if applicable)
   * Note: Iyzico uses callbacks but doesn't have webhook signature verification like Stripe
   */
  verifyCallback(payload: any): boolean {
    // Iyzico doesn't provide webhook signature verification
    // You might want to implement your own verification mechanism
    // For now, we'll just validate the payload structure
    return payload && payload.status && payload.paymentId;
  }

  /**
   * Handle payment callback
   */
  async handlePaymentCallback(payload: any) {
    this.logger.log(`Iyzico payment callback received: ${JSON.stringify(payload)}`);

    return {
      paymentId: payload.paymentId,
      status: payload.status,
      conversationId: payload.conversationId,
      errorMessage: payload.errorMessage,
    };
  }

  /**
   * Cancel subscription
   * Note: Iyzico doesn't have native subscription management
   * We cancel by stopping future recurring payments
   */
  async cancelSubscription(iyzicoSubscriptionId: string, immediate: boolean = false): Promise<void> {
    this.logger.log(`Cancelling Iyzico subscription: ${iyzicoSubscriptionId} (immediate: ${immediate})`);

    // Iyzico doesn't have a native subscription cancel API
    // The subscription cancellation is handled in our database
    // Future recurring payment jobs will check the subscription status

    if (immediate) {
      this.logger.log('Immediate cancellation - no recurring charges will be made');
    } else {
      this.logger.log('Cancel at period end - final payment will be processed at cycle end');
    }

    // No API call needed for Iyzico - cancellation is database-driven
    return Promise.resolve();
  }

  /**
   * Helper: Format customer data for Iyzico
   */
  formatCustomerData(
    tenantId: string,
    email: string,
    name: string,
    phone: string = '+905350000000',
    identityNumber: string = '11111111111',
  ): IyzicoCustomer {
    const nameParts = name.split(' ');
    const firstName = nameParts[0] || 'Name';
    const lastName = nameParts.slice(1).join(' ') || 'Surname';

    return {
      id: tenantId,
      email,
      name: firstName,
      surname: lastName,
      identityNumber, // Turkish ID number - should be collected from user
      gsmNumber: phone, // Should be in format +905XXXXXXXXX
      city: 'Istanbul',
      country: 'Turkey',
      address: 'Address',
      zipCode: '34000',
    };
  }
}
