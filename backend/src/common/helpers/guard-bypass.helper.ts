import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../../modules/auth/decorators/public.decorator";
import {
  IS_SUPERADMIN_PUBLIC_KEY,
  IS_SUPERADMIN_ROUTE_KEY,
} from "../../modules/superadmin/decorators/superadmin.decorator";

/**
 * Shared check used by JwtAuthGuard / RolesGuard / TenantGuard to decide
 * whether the main-app auth pipeline should be skipped for this route.
 * Keeping this in one place avoids drift as new realms (e.g. superadmin)
 * add their own decorators. (The marketing realm moved to the separate
 * kds-marketing service; its bypass key left with it.)
 */
export function shouldBypassGlobalAuth(
  reflector: Reflector,
  context: ExecutionContext,
): boolean {
  const targets = [context.getHandler(), context.getClass()];
  return (
    !!reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ||
    !!reflector.getAllAndOverride<boolean>(IS_SUPERADMIN_PUBLIC_KEY, targets) ||
    !!reflector.getAllAndOverride<boolean>(IS_SUPERADMIN_ROUTE_KEY, targets)
  );
}
