import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { EntitlementService } from './entitlement.service';
import { allowsIntegration, hasFeature, isUnlimitedLimit, limitOf } from './entitlement-engine';
import {
  EntitlementRequirement,
  REQUIRE_ENTITLEMENT_KEY,
} from './require-entitlement.decorator';

/**
 * Guard backing @RequireEntitlement. Public routes pass through; non-public
 * routes without the decorator pass through too — entitlement gates are
 * opt-in per route, not blanket like the auth guard. The Forbidden messages
 * deliberately stay terse: error bodies leak product structure, so detail
 * lives in the upsell modal the client renders on 403.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const reqs = this.reflector.getAllAndOverride<EntitlementRequirement[]>(
      REQUIRE_ENTITLEMENT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!reqs || reqs.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const tenantId: string | undefined = req.user?.tenantId;
    if (!tenantId) throw new ForbiddenException('Authentication required');

    const branchId: string | null = req.user?.branchId ?? null;
    const set = await this.entitlements.getForTenant(tenantId, branchId);

    for (const r of reqs) {
      if (typeof r === 'string') {
        if (!hasFeature(set, r)) throw new ForbiddenException(`Feature not enabled: ${r}`);
        continue;
      }
      if ('feature' in r) {
        if (!hasFeature(set, r.feature)) {
          throw new ForbiddenException(`Feature not enabled: ${r.feature}`);
        }
      } else if ('limit' in r) {
        if (isUnlimitedLimit(set, r.limit)) continue;
        const usage = typeof r.usage === 'function' ? await r.usage(req) : r.usage;
        const cap = limitOf(set, r.limit, 0);
        if (cap > 0 && usage >= cap) {
          throw new ForbiddenException(`Limit reached for ${r.limit} (${usage}/${cap})`);
        }
      } else if ('integration' in r) {
        if (!allowsIntegration(set, r.integration, r.provider)) {
          throw new ForbiddenException(`Integration not enabled: ${r.provider}`);
        }
      }
    }
    return true;
  }
}
