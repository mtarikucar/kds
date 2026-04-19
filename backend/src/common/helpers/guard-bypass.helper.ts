import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../modules/auth/decorators/public.decorator';
import {
  IS_SUPERADMIN_PUBLIC_KEY,
  IS_SUPERADMIN_ROUTE_KEY,
} from '../../modules/superadmin/decorators/superadmin.decorator';
import { IS_MARKETING_ROUTE_KEY } from '../../modules/marketing/decorators/marketing-public.decorator';

/**
 * Shared check used by JwtAuthGuard / RolesGuard / TenantGuard to decide
 * whether the main-app auth pipeline should be skipped for this route.
 * Keeping this in one place avoids drift as new realms (superadmin,
 * marketing, etc.) add their own decorators.
 */
export function shouldBypassGlobalAuth(
  reflector: Reflector,
  context: ExecutionContext,
): boolean {
  const targets = [context.getHandler(), context.getClass()];
  return (
    !!reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ||
    !!reflector.getAllAndOverride<boolean>(IS_SUPERADMIN_PUBLIC_KEY, targets) ||
    !!reflector.getAllAndOverride<boolean>(IS_SUPERADMIN_ROUTE_KEY, targets) ||
    !!reflector.getAllAndOverride<boolean>(IS_MARKETING_ROUTE_KEY, targets)
  );
}
