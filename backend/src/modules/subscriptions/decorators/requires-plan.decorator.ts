import { SetMetadata } from '@nestjs/common';
import { SubscriptionPlanType } from '../../../common/constants/subscription.enum';

export const REQUIRED_PLANS_KEY = 'requiredPlans';

/**
 * Decorator to specify which subscription plans are required to access a route
 * @param plans - Array of subscription plan types that have access
 */
export const RequiresPlan = (...plans: SubscriptionPlanType[]) =>
  SetMetadata(REQUIRED_PLANS_KEY, plans);
