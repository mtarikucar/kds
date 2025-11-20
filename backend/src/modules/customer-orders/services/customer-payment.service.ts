import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import * as Iyzipay from 'iyzipay';
import {
  CreateCustomerPaymentDto,
  ConfirmCustomerPaymentDto,
  CustomerPaymentIntentResponse,
  CustomerPaymentConfirmationResponse,
  PaymentProvider,
} from '../dto/create-customer-payment.dto';
import { OrderStatus } from '@prisma/client';

@Injectable()
export class CustomerPaymentService {
  private stripe: Stripe;
  private iyzipay: any;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    // Initialize Stripe
    const stripeKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (stripeKey) {
      this.stripe = new Stripe(stripeKey, {
        apiVersion: '2024-10-28.acacia',
      });
    }

    // Initialize Iyzico
    const iyzicoApiKey = this.configService.get<string>('IYZICO_API_KEY');
    const iyzicoSecretKey = this.configService.get<string>('IYZICO_SECRET_KEY');
    const iyzicoBaseUrl = this.configService.get<string>('IYZICO_BASE_URL');

    if (iyzicoApiKey && iyzicoSecretKey) {
      this.iyzipay = new Iyzipay({
        apiKey: iyzicoApiKey,
        secretKey: iyzicoSecretKey,
        uri: iyzicoBaseUrl || 'https://sandbox-api.iyzipay.com',
      });
    }
  }

  /**
   * Create a payment intent for a customer order
   */
  async createPaymentIntent(
    dto: CreateCustomerPaymentDto,
  ): Promise<CustomerPaymentIntentResponse> {
    // Validate session
    const session = await this.prisma.customerSession.findUnique({
      where: { id: dto.sessionId },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    // Get order
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      include: {
        items: {
          include: { product: true },
        },
        table: true,
        customer: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Verify order belongs to this session
    if (order.sessionId !== dto.sessionId) {
      throw new BadRequestException('Order does not belong to this session');
    }

    // Check if order is already paid
    if (order.status === OrderStatus.PAID) {
      throw new BadRequestException('Order is already paid');
    }

    // Calculate total amount including tip
    const orderAmount = Number(order.finalAmount);
    const tipAmount = dto.tipAmount || 0;
    const totalAmount = orderAmount + tipAmount;

    // Create payment based on provider
    if (dto.provider === PaymentProvider.STRIPE) {
      return await this.createStripePaymentIntent(order, totalAmount, tipAmount, dto);
    } else if (dto.provider === PaymentProvider.IYZICO) {
      return await this.createIyzicoPaymentIntent(order, totalAmount, tipAmount, dto);
    }

    throw new BadRequestException('Invalid payment provider');
  }

  /**
   * Create Stripe payment intent
   */
  private async createStripePaymentIntent(
    order: any,
    totalAmount: number,
    tipAmount: number,
    dto: CreateCustomerPaymentDto,
  ): Promise<CustomerPaymentIntentResponse> {
    if (!this.stripe) {
      throw new BadRequestException('Stripe is not configured');
    }

    // Convert to cents
    const amountInCents = Math.round(totalAmount * 100);

    // Create payment intent
    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd', // TODO: Make configurable per tenant
      metadata: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        tenantId: order.tenantId,
        tipAmount: tipAmount.toString(),
        orderAmount: order.finalAmount.toString(),
      },
      description: `Order ${order.orderNumber}`,
      automatic_payment_methods: {
        enabled: true,
      },
    });

    // Store payment intent reference
    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        metadata: {
          ...(order.metadata as object || {}),
          stripePaymentIntentId: paymentIntent.id,
          tipAmount,
        },
      },
    });

    return {
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      amount: totalAmount,
      currency: 'usd',
      provider: PaymentProvider.STRIPE,
      orderId: order.id,
      status: paymentIntent.status,
      publishableKey: this.configService.get<string>('STRIPE_PUBLISHABLE_KEY'),
    };
  }

  /**
   * Create Iyzico payment intent
   */
  private async createIyzicoPaymentIntent(
    order: any,
    totalAmount: number,
    tipAmount: number,
    dto: CreateCustomerPaymentDto,
  ): Promise<CustomerPaymentIntentResponse> {
    if (!this.iyzipay) {
      throw new BadRequestException('Iyzico is not configured');
    }

    // Prepare buyer information
    const buyer = {
      id: order.customer?.id || 'GUEST',
      name: order.customer?.name || 'Guest',
      surname: 'Customer',
      email: order.customer?.email || 'guest@restaurant.com',
      identityNumber: '11111111111', // Turkish ID required
      registrationAddress: 'Restaurant Table',
      city: 'Istanbul',
      country: 'Turkey',
      ip: '85.34.78.112', // TODO: Get real IP
    };

    // Prepare basket items
    const basketItems = order.items.map((item: any, index: number) => ({
      id: `item_${index}`,
      name: item.product.name,
      category1: 'Food',
      itemType: 'PHYSICAL',
      price: (Number(item.totalPrice) / item.quantity).toFixed(2),
    }));

    // Add tip as basket item if present
    if (tipAmount > 0) {
      basketItems.push({
        id: 'tip',
        name: 'Tip',
        category1: 'Service',
        itemType: 'VIRTUAL',
        price: tipAmount.toFixed(2),
      });
    }

    const request = {
      locale: 'tr',
      conversationId: `order_${order.orderNumber}`,
      price: totalAmount.toFixed(2),
      paidPrice: totalAmount.toFixed(2),
      currency: 'TRY',
      basketId: order.id,
      paymentGroup: 'PRODUCT',
      callbackUrl: dto.returnUrl || `${this.configService.get('FRONTEND_URL')}/payment/callback`,
      enabledInstallments: [1],
      buyer,
      shippingAddress: {
        contactName: buyer.name,
        city: buyer.city,
        country: buyer.country,
        address: buyer.registrationAddress,
      },
      billingAddress: {
        contactName: buyer.name,
        city: buyer.city,
        country: buyer.country,
        address: buyer.registrationAddress,
      },
      basketItems,
    };

    return new Promise((resolve, reject) => {
      this.iyzipay.checkoutFormInitialize.create(request, async (err: any, result: any) => {
        if (err) {
          reject(new BadRequestException(`Iyzico error: ${err.message}`));
          return;
        }

        if (result.status !== 'success') {
          reject(new BadRequestException(`Iyzico error: ${result.errorMessage}`));
          return;
        }

        // Store payment token
        await this.prisma.order.update({
          where: { id: order.id },
          data: {
            metadata: {
              ...(order.metadata as object || {}),
              iyzicoToken: result.token,
              iyzicoConversationId: request.conversationId,
              tipAmount,
            },
          },
        });

        resolve({
          paymentIntentId: result.token,
          clientSecret: result.token,
          amount: totalAmount,
          currency: 'TRY',
          provider: PaymentProvider.IYZICO,
          orderId: order.id,
          status: 'pending',
          checkoutFormContent: result.checkoutFormContent,
        });
      });
    });
  }

  /**
   * Confirm a customer payment
   */
  async confirmPayment(
    dto: ConfirmCustomerPaymentDto,
  ): Promise<CustomerPaymentConfirmationResponse> {
    // Find order by payment intent ID
    const order = await this.prisma.order.findFirst({
      where: {
        OR: [
          { metadata: { path: ['stripePaymentIntentId'], equals: dto.paymentIntentId } },
          { metadata: { path: ['iyzicoToken'], equals: dto.paymentIntentId } },
        ],
      },
      include: { payments: true },
    });

    if (!order) {
      throw new NotFoundException('Order not found for this payment intent');
    }

    // Check if already paid
    if (order.status === OrderStatus.PAID) {
      return {
        success: true,
        orderId: order.id,
        paymentId: order.payments[0]?.id || '',
        message: 'Order is already paid',
      };
    }

    // Get metadata
    const metadata = order.metadata as any || {};
    const tipAmount = metadata.tipAmount || 0;
    const totalAmount = Number(order.finalAmount) + tipAmount;

    // Verify payment with provider
    let paymentVerified = false;
    let paymentMethod = 'CARD';

    if (metadata.stripePaymentIntentId) {
      paymentVerified = await this.verifyStripePayment(dto.paymentIntentId);
      paymentMethod = 'STRIPE';
    } else if (metadata.iyzicoToken) {
      paymentVerified = await this.verifyIyzicoPayment(dto.paymentIntentId);
      paymentMethod = 'IYZICO';
    }

    if (!paymentVerified) {
      throw new BadRequestException('Payment verification failed');
    }

    // Create payment record
    const payment = await this.prisma.payment.create({
      data: {
        orderId: order.id,
        amount: totalAmount,
        method: paymentMethod,
        status: 'COMPLETED',
        transactionId: dto.paymentIntentId,
        metadata: {
          provider: metadata.stripePaymentIntentId ? 'STRIPE' : 'IYZICO',
          tipAmount,
          orderAmount: order.finalAmount,
        },
        tenantId: order.tenantId,
      },
    });

    // Update order status
    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.PAID,
        paidAt: new Date(),
      },
    });

    // Update customer statistics if customer exists
    if (order.customerId) {
      await this.prisma.customer.update({
        where: { id: order.customerId },
        data: {
          totalOrders: { increment: 1 },
          totalSpent: { increment: totalAmount },
          lastVisit: new Date(),
        },
      });

      // Award loyalty points
      const pointsEarned = Math.floor(totalAmount);
      await this.prisma.loyaltyTransaction.create({
        data: {
          customerId: order.customerId,
          type: 'EARNED',
          points: pointsEarned,
          description: `Points earned from order ${order.orderNumber}`,
          orderId: order.id,
          tenantId: order.tenantId,
        },
      });

      await this.prisma.customer.update({
        where: { id: order.customerId },
        data: {
          loyaltyPoints: { increment: pointsEarned },
        },
      });
    }

    return {
      success: true,
      orderId: order.id,
      paymentId: payment.id,
      receiptUrl: `/api/customer-public/orders/${order.id}/receipt`,
      message: 'Payment completed successfully',
    };
  }

  /**
   * Verify Stripe payment
   */
  private async verifyStripePayment(paymentIntentId: string): Promise<boolean> {
    if (!this.stripe) return false;

    try {
      const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      return paymentIntent.status === 'succeeded';
    } catch (error) {
      console.error('Stripe verification error:', error);
      return false;
    }
  }

  /**
   * Verify Iyzico payment
   */
  private async verifyIyzicoPayment(token: string): Promise<boolean> {
    if (!this.iyzipay) return false;

    return new Promise((resolve) => {
      this.iyzipay.checkoutForm.retrieve({ token }, (err: any, result: any) => {
        if (err || result.status !== 'success') {
          resolve(false);
          return;
        }
        resolve(result.paymentStatus === 'SUCCESS');
      });
    });
  }

  /**
   * Get payment status
   */
  async getPaymentStatus(orderId: string, sessionId: string): Promise<any> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: true },
    });

    if (!order || order.sessionId !== sessionId) {
      throw new NotFoundException('Order not found');
    }

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      amount: order.finalAmount,
      isPaid: order.status === OrderStatus.PAID,
      paidAt: order.paidAt,
      payments: order.payments,
    };
  }
}
