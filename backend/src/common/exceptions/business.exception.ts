import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../interfaces/error-response.interface';

/**
 * Custom exception for business logic errors
 * Use this for domain-specific errors that need custom error codes
 */
export class BusinessException extends HttpException {
  constructor(
    message: string,
    public readonly errorCode: ErrorCode,
    statusCode: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: any,
  ) {
    super(
      {
        message,
        errorCode,
        details,
      },
      statusCode,
    );
  }
}

/**
 * Resource not found exception
 */
export class ResourceNotFoundException extends BusinessException {
  constructor(resource: string, identifier?: string | number) {
    const message = identifier
      ? `${resource} with ID '${identifier}' not found`
      : `${resource} not found`;
    super(message, ErrorCode.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
  }
}

/**
 * Resource already exists exception
 */
export class ResourceAlreadyExistsException extends BusinessException {
  constructor(resource: string, field?: string, value?: any) {
    const message = field
      ? `${resource} with ${field} '${value}' already exists`
      : `${resource} already exists`;
    super(message, ErrorCode.RESOURCE_ALREADY_EXISTS, HttpStatus.CONFLICT);
  }
}

/**
 * Insufficient permissions exception
 */
export class InsufficientPermissionsException extends BusinessException {
  constructor(action: string) {
    super(
      `You don't have permission to ${action}`,
      ErrorCode.INSUFFICIENT_PERMISSIONS,
      HttpStatus.FORBIDDEN,
    );
  }
}

/**
 * Invalid credentials exception
 */
export class InvalidCredentialsException extends BusinessException {
  constructor() {
    super(
      'Invalid email or password',
      ErrorCode.INVALID_CREDENTIALS,
      HttpStatus.UNAUTHORIZED,
    );
  }
}

/**
 * Subscription required exception
 */
export class SubscriptionRequiredException extends BusinessException {
  constructor(feature: string) {
    super(
      `This feature requires an active subscription. Please upgrade your plan to access ${feature}`,
      ErrorCode.SUBSCRIPTION_REQUIRED,
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

/**
 * Feature not available exception
 */
export class FeatureNotAvailableException extends BusinessException {
  constructor(feature: string, requiredPlan: string) {
    super(
      `The ${feature} feature is not available on your current plan. Please upgrade to ${requiredPlan} or higher`,
      ErrorCode.FEATURE_NOT_AVAILABLE,
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

/**
 * Quota exceeded exception
 */
export class QuotaExceededException extends BusinessException {
  constructor(resource: string, limit: number) {
    super(
      `You have reached the maximum limit of ${limit} ${resource} for your current plan`,
      ErrorCode.QUOTA_EXCEEDED,
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

/**
 * Invalid order status exception
 */
export class InvalidOrderStatusException extends BusinessException {
  constructor(currentStatus: string, attemptedAction: string) {
    super(
      `Cannot ${attemptedAction} an order with status '${currentStatus}'`,
      ErrorCode.INVALID_ORDER_STATUS,
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * Insufficient stock exception
 */
export class InsufficientStockException extends BusinessException {
  constructor(productName: string, available: number, requested: number) {
    super(
      `Insufficient stock for ${productName}. Available: ${available}, Requested: ${requested}`,
      ErrorCode.INSUFFICIENT_STOCK,
      HttpStatus.BAD_REQUEST,
      { productName, available, requested },
    );
  }
}
