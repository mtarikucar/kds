import { HttpStatus } from '@nestjs/common';
import { BusinessException } from './business.exception';
import { ErrorCode } from '../interfaces/error-response.interface';

/**
 * Payment failed exception
 */
export class PaymentFailedException extends BusinessException {
  constructor(reason?: string, details?: any) {
    const message = reason
      ? `Payment failed: ${reason}`
      : 'Payment failed';
    super(message, ErrorCode.PAYMENT_FAILED, HttpStatus.PAYMENT_REQUIRED, details);
  }
}

/**
 * Payment processing error exception
 */
export class PaymentProcessingException extends BusinessException {
  constructor(message: string, details?: any) {
    super(
      message,
      ErrorCode.PAYMENT_PROCESSING_ERROR,
      HttpStatus.BAD_REQUEST,
      details,
    );
  }
}

/**
 * Invalid payment method exception
 */
export class InvalidPaymentMethodException extends BusinessException {
  constructor(method?: string) {
    const message = method
      ? `Invalid payment method: ${method}`
      : 'Invalid payment method';
    super(message, ErrorCode.INVALID_PAYMENT_METHOD, HttpStatus.BAD_REQUEST);
  }
}

/**
 * Order already paid exception
 */
export class OrderAlreadyPaidException extends BusinessException {
  constructor(orderId: string) {
    super(
      `Order ${orderId} has already been paid`,
      ErrorCode.ORDER_ALREADY_PAID,
      HttpStatus.BAD_REQUEST,
      { orderId },
    );
  }
}
