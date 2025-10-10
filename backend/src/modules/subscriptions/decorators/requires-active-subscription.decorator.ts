import { SetMetadata } from '@nestjs/common';

export const REQUIRES_ACTIVE_SUBSCRIPTION_KEY = 'requiresActiveSubscription';

/**
 * Decorator to mark routes that require an active subscription
 */
export const RequiresActiveSubscription = () =>
  SetMetadata(REQUIRES_ACTIVE_SUBSCRIPTION_KEY, true);
