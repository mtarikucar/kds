import { HttpException, HttpStatus } from "@nestjs/common";
import { ErrorCode } from "../interfaces/error-response.interface";

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
      "Invalid email or password",
      ErrorCode.INVALID_CREDENTIALS,
      HttpStatus.UNAUTHORIZED,
    );
  }
}

/**
 * Licence required — the annual licence is the prerequisite for switching on
 * any paid module, so a missing licence blocks the module even when the module
 * itself was bought.
 *
 * Prefer `EntitlementRequiredException`: it carries the resolved offer (name,
 * prorated price, period) so the client can render a real Buy/Renew action
 * instead of a dead end.
 */
export class SubscriptionRequiredException extends BusinessException {
  constructor(feature: string) {
    super(
      `${feature} needs an active licence. Activate or renew the annual licence in the Marketplace to switch the module on`,
      ErrorCode.SUBSCRIPTION_REQUIRED,
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

/**
 * Module not active — the capability exists but this account does not hold the
 * product that grants it. There is nothing to "upgrade to": modules are bought
 * one at a time, annually, and adding one never disturbs the rest.
 *
 * Prefer `EntitlementRequiredException` for the same reason as above.
 */
export class FeatureNotAvailableException extends BusinessException {
  constructor(feature: string, requiredProduct: string) {
    super(
      `${feature} is not included in the free core. It is unlocked by the ${requiredProduct} module, available annually in the Marketplace`,
      ErrorCode.FEATURE_NOT_AVAILABLE,
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

/**
 * Capacity exceeded — a numeric entitlement (`limit.*`) is used up.
 */
export class QuotaExceededException extends BusinessException {
  constructor(resource: string, limit: number) {
    super(
      `You have reached your limit of ${limit} ${resource}. Add capacity from the Marketplace to raise it`,
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
