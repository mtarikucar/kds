/**
 * Centralized exports for all custom exceptions
 * Import from this file to ensure consistency across the application
 *
 * @example
 * import { ResourceNotFoundException, InvalidCredentialsException } from '@/common/exceptions';
 */

// Base exception
export { BusinessException } from './business.exception';

// Resource exceptions
export { ResourceNotFoundException } from './business.exception';
export { ResourceAlreadyExistsException } from './business.exception';

// Authentication exceptions
export { InvalidCredentialsException } from './business.exception';

// Authorization exceptions
export { InsufficientPermissionsException } from './business.exception';

// Subscription exceptions
export { SubscriptionRequiredException } from './business.exception';
export { FeatureNotAvailableException } from './business.exception';
export { QuotaExceededException } from './business.exception';

// Order exceptions
export { InvalidOrderStatusException } from './business.exception';
export { InsufficientStockException } from './business.exception';

// Export additional specialized exceptions
export * from './validation.exception';
export * from './payment.exception';
