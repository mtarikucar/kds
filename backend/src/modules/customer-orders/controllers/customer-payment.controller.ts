import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { CustomerPaymentService } from '../services/customer-payment.service';
import {
  CreateCustomerPaymentDto,
  ConfirmCustomerPaymentDto,
  CustomerPaymentIntentResponse,
  CustomerPaymentConfirmationResponse,
} from '../dto/create-customer-payment.dto';

/**
 * Public customer payment controller
 * No authentication required - uses session validation
 */
@Controller('customer-public/payments')
export class CustomerPaymentController {
  constructor(private readonly paymentService: CustomerPaymentService) {}

  /**
   * Create a payment intent for an order
   * POST /customer-public/payments/create-intent
   */
  @Post('create-intent')
  async createPaymentIntent(
    @Body() dto: CreateCustomerPaymentDto,
  ): Promise<CustomerPaymentIntentResponse> {
    return await this.paymentService.createPaymentIntent(dto);
  }

  /**
   * Confirm a payment
   * POST /customer-public/payments/confirm
   */
  @Post('confirm')
  async confirmPayment(
    @Body() dto: ConfirmCustomerPaymentDto,
  ): Promise<CustomerPaymentConfirmationResponse> {
    return await this.paymentService.confirmPayment(dto);
  }

  /**
   * Get payment status for an order
   * GET /customer-public/payments/status/:orderId?sessionId=xxx
   */
  @Get('status/:orderId')
  async getPaymentStatus(
    @Param('orderId') orderId: string,
    @Query('sessionId') sessionId: string,
  ): Promise<any> {
    return await this.paymentService.getPaymentStatus(orderId, sessionId);
  }
}
