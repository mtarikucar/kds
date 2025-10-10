import { SetMetadata } from '@nestjs/common';
import { PlanFeature } from '../../../common/constants/subscription.enum';

export const REQUIRED_FEATURES_KEY = 'requiredFeatures';

/**
 * Decorator to specify which features are required to access a route
 * @param features - Array of features that must be enabled in the subscription plan
 */
export const RequiresFeature = (...features: PlanFeature[]) =>
  SetMetadata(REQUIRED_FEATURES_KEY, features);
