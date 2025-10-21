/**
 * Standardized error response interface
 * All API errors will follow this structure
 */
export interface ErrorResponse {
  /**
   * HTTP status code
   */
  statusCode: number;

  /**
   * Error message (user-friendly)
   */
  message: string | string[];

  /**
   * Error type/code for client-side handling
   */
  error: string;

  /**
   * Request timestamp
   */
  timestamp: string;

  /**
   * Request path
   */
  path: string;

  /**
   * Error details (only in development mode)
   */
  details?: any;

  /**
   * Stack trace (only in development mode)
   */
  stack?: string;

  /**
   * Request ID for tracking
   */
  requestId?: string;
}

/**
 * Business logic error codes
 */
export enum ErrorCode {
  // Authentication errors
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  UNAUTHORIZED = 'UNAUTHORIZED',

  // Authorization errors
  FORBIDDEN = 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',

  // Resource errors
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  RESOURCE_ALREADY_EXISTS = 'RESOURCE_ALREADY_EXISTS',
  RESOURCE_CONFLICT = 'RESOURCE_CONFLICT',

  // Validation errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',

  // Business logic errors
  INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK',
  ORDER_ALREADY_PAID = 'ORDER_ALREADY_PAID',
  TABLE_OCCUPIED = 'TABLE_OCCUPIED',
  INVALID_ORDER_STATUS = 'INVALID_ORDER_STATUS',
  SUBSCRIPTION_REQUIRED = 'SUBSCRIPTION_REQUIRED',
  FEATURE_NOT_AVAILABLE = 'FEATURE_NOT_AVAILABLE',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',

  // Payment errors
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  PAYMENT_PROCESSING_ERROR = 'PAYMENT_PROCESSING_ERROR',
  INVALID_PAYMENT_METHOD = 'INVALID_PAYMENT_METHOD',

  // System errors
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  DATABASE_ERROR = 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',

  // Rate limiting
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',

  // Tenant errors
  TENANT_NOT_FOUND = 'TENANT_NOT_FOUND',
  INVALID_TENANT = 'INVALID_TENANT',
}
