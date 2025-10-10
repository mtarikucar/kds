import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRES_ACTIVE_SUBSCRIPTION_KEY } from '../decorators/requires-active-subscription.decorator';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { SubscriptionService } from '../services/subscription.service';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private subscriptionService: SubscriptionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // Check if route requires active subscription
    const requiresSubscription = this.reflector.getAllAndOverride<boolean>(
      REQUIRES_ACTIVE_SUBSCRIPTION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiresSubscription) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.tenantId) {
      throw new ForbiddenException('User not authenticated or tenant not found');
    }

    // Check if subscription is active
    const isActive = await this.subscriptionService.isSubscriptionActive(user.tenantId);

    if (!isActive) {
      throw new ForbiddenException(
        'Your subscription has expired or is inactive. Please renew your subscription to continue.',
      );
    }

    return true;
  }
}
