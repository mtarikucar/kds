import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { BillingCycle } from '../../../common/constants/subscription.enum';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private stripe: Stripe;

  constructor(private configService: ConfigService) {
    const stripeSecretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) {
      this.logger.warn('Stripe secret key not configured');
    } else {
      this.stripe = new Stripe(stripeSecretKey, {
        apiVersion: '2025-09-30.clover',
      });
    }
  }

  /**
   * Create a Stripe customer
   */
  async createCustomer(email: string, name: string, metadata?: Record<string, string>): Promise<Stripe.Customer> {
    try {
      return await this.stripe.customers.create({
        email,
        name,
        metadata,
      });
    } catch (error) {
      this.logger.error(`Failed to create Stripe customer: ${error.message}`);
      throw new BadRequestException('Failed to create payment customer');
    }
  }

  /**
   * Create a payment (alias for createPaymentIntent for interface compatibility)
   */
  async createPayment(
    amount: number,
    currency: string,
    customerId: string,
    metadata?: Record<string, string>,
  ): Promise<Stripe.PaymentIntent> {
    return this.createPaymentIntent(amount, currency, customerId, metadata);
  }

  /**
   * Create a payment intent for subscription
   */
  async createPaymentIntent(
    amount: number,
    currency: string,
    customerId: string,
    metadata?: Record<string, string>,
  ): Promise<Stripe.PaymentIntent> {
    try {
      return await this.stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: currency.toLowerCase(),
        customer: customerId,
        metadata,
        automatic_payment_methods: {
          enabled: true,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to create payment intent: ${error.message}`);
      throw new BadRequestException('Failed to create payment intent');
    }
  }

  /**
   * Create a Stripe subscription
   */
  async createSubscription(
    customerId: string,
    priceId: string,
    trialDays?: number,
    metadata?: Record<string, string>,
  ): Promise<Stripe.Subscription> {
    try {
      const subscriptionData: Stripe.SubscriptionCreateParams = {
        customer: customerId,
        items: [{ price: priceId }],
        metadata,
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.payment_intent'],
      };

      if (trialDays && trialDays > 0) {
        subscriptionData.trial_period_days = trialDays;
      }

      return await this.stripe.subscriptions.create(subscriptionData);
    } catch (error) {
      this.logger.error(`Failed to create subscription: ${error.message}`);
      throw new BadRequestException('Failed to create subscription');
    }
  }

  /**
   * Update a Stripe subscription
   */
  async updateSubscription(
    subscriptionId: string,
    updates: Partial<Stripe.SubscriptionUpdateParams>,
  ): Promise<Stripe.Subscription> {
    try {
      return await this.stripe.subscriptions.update(subscriptionId, updates);
    } catch (error) {
      this.logger.error(`Failed to update subscription: ${error.message}`);
      throw new BadRequestException('Failed to update subscription');
    }
  }

  /**
   * Cancel a Stripe subscription
   */
  async cancelSubscription(subscriptionId: string, immediate: boolean = false): Promise<Stripe.Subscription> {
    try {
      if (immediate) {
        return await this.stripe.subscriptions.cancel(subscriptionId);
      } else {
        return await this.stripe.subscriptions.update(subscriptionId, {
          cancel_at_period_end: true,
        });
      }
    } catch (error) {
      this.logger.error(`Failed to cancel subscription: ${error.message}`);
      throw new BadRequestException('Failed to cancel subscription');
    }
  }

  /**
   * Retrieve a Stripe subscription
   */
  async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    try {
      return await this.stripe.subscriptions.retrieve(subscriptionId);
    } catch (error) {
      this.logger.error(`Failed to retrieve subscription: ${error.message}`);
      throw new BadRequestException('Failed to retrieve subscription');
    }
  }

  /**
   * Create or retrieve a Stripe price
   */
  async createPrice(
    productId: string,
    amount: number,
    currency: string,
    interval: 'month' | 'year',
  ): Promise<Stripe.Price> {
    try {
      return await this.stripe.prices.create({
        product: productId,
        unit_amount: Math.round(amount * 100),
        currency: currency.toLowerCase(),
        recurring: { interval },
      });
    } catch (error) {
      this.logger.error(`Failed to create price: ${error.message}`);
      throw new BadRequestException('Failed to create price');
    }
  }

  /**
   * Create a Stripe product
   */
  async createProduct(name: string, description?: string): Promise<Stripe.Product> {
    try {
      return await this.stripe.products.create({
        name,
        description,
      });
    } catch (error) {
      this.logger.error(`Failed to create product: ${error.message}`);
      throw new BadRequestException('Failed to create product');
    }
  }

  /**
   * Retrieve a payment intent
   */
  async getPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    try {
      return await this.stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (error) {
      this.logger.error(`Failed to retrieve payment intent: ${error.message}`);
      throw new BadRequestException('Failed to retrieve payment intent');
    }
  }

  /**
   * Confirm a payment intent
   */
  async confirmPaymentIntent(
    paymentIntentId: string,
    paymentMethodId: string,
  ): Promise<Stripe.PaymentIntent> {
    try {
      return await this.stripe.paymentIntents.confirm(paymentIntentId, {
        payment_method: paymentMethodId,
      });
    } catch (error) {
      this.logger.error(`Failed to confirm payment intent: ${error.message}`);
      throw new BadRequestException('Failed to confirm payment');
    }
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(payload: string | Buffer, signature: string): Stripe.Event {
    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) {
      throw new BadRequestException('Webhook secret not configured');
    }

    try {
      return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (error) {
      this.logger.error(`Webhook signature verification failed: ${error.message}`);
      throw new BadRequestException('Invalid webhook signature');
    }
  }

  /**
   * Handle subscription status changes from webhooks
   */
  async handleSubscriptionUpdate(subscription: Stripe.Subscription) {
    this.logger.log(`Subscription ${subscription.id} status: ${subscription.status}`);
    const sub = subscription as any;
    return {
      subscriptionId: subscription.id,
      status: subscription.status,
      currentPeriodStart: new Date(sub.current_period_start * 1000),
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    };
  }

  /**
   * Handle payment success from webhooks
   */
  async handlePaymentSuccess(paymentIntent: Stripe.PaymentIntent) {
    this.logger.log(`Payment succeeded: ${paymentIntent.id}`);
    return {
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount / 100,
      currency: paymentIntent.currency,
      status: paymentIntent.status,
    };
  }

  /**
   * Handle payment failure from webhooks
   */
  async handlePaymentFailure(paymentIntent: Stripe.PaymentIntent) {
    this.logger.log(`Payment failed: ${paymentIntent.id}`);
    return {
      paymentIntentId: paymentIntent.id,
      error: paymentIntent.last_payment_error?.message || 'Unknown error',
    };
  }

  /**
   * Create a setup intent for saving payment methods
   */
  async createSetupIntent(customerId: string): Promise<Stripe.SetupIntent> {
    try {
      return await this.stripe.setupIntents.create({
        customer: customerId,
        payment_method_types: ['card'],
      });
    } catch (error) {
      this.logger.error(`Failed to create setup intent: ${error.message}`);
      throw new BadRequestException('Failed to create setup intent');
    }
  }

  /**
   * Attach payment method to customer
   */
  async attachPaymentMethod(paymentMethodId: string, customerId: string): Promise<Stripe.PaymentMethod> {
    try {
      return await this.stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId,
      });
    } catch (error) {
      this.logger.error(`Failed to attach payment method: ${error.message}`);
      throw new BadRequestException('Failed to attach payment method');
    }
  }

  /**
   * Set default payment method
   */
  async setDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<Stripe.Customer> {
    try {
      return await this.stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to set default payment method: ${error.message}`);
      throw new BadRequestException('Failed to set default payment method');
    }
  }
}
