import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../../auth/decorators/public.decorator";
import { PrismaService } from "../../../prisma/prisma.service";

/**
 * Global lock for the onboarding-trial redesign.
 *
 * A tenant whose onboarding trial has ended without a paid subscription is in
 * status TRIAL_ENDED (and EXPIRED/CANCELLED tenants are likewise not live).
 * Such a tenant is LOCKED: every tenant-scoped route is 403'd EXCEPT an
 * allowlist needed to recover (see plans, pay, refresh tokens, read profile).
 * This is the default-deny backend half of the lock; the SPA's SubscriptionGate
 * redirects to /choose-plan on the PLAN_SELECTION_REQUIRED code.
 *
 * Registered as the LAST APP_GUARD (after Jwt/Tenant/Branch) so req.user.tenantId
 * is set. Superadmin requests carry no req.user.tenantId, so they fly through.
 *
 * NOTE: this adds one indexed subscription lookup per non-allowlisted tenant
 * request. A short-TTL per-tenant cache (invalidated on settlement/expiry) is a
 * follow-up optimization if request volume warrants it.
 */
@Injectable()
export class SubscriptionStatusGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  // Path prefixes (after the /api global prefix) a LOCKED tenant may still
  // reach: auth/session, own profile, the plan catalog + current subscription,
  // the payment + checkout rails, legal consent docs, entitlement self-read,
  // public webhooks, and health. Everything else is gated.
  private static readonly UNLOCKED_PREFIXES = [
    "/auth",
    "/me",
    "/users/me",
    "/profile",
    "/subscriptions",
    "/payments",
    "/checkout",
    "/legal",
    "/entitlements",
    "/webhooks",
    "/health",
  ];

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const tenantId = request.user?.tenantId;
    // No tenant principal (unauthenticated handled by JwtAuthGuard, or the
    // superadmin realm) — nothing to lock here.
    if (!tenantId) return true;

    const path: string = String(request.path ?? request.url ?? "").split(
      "?",
    )[0];
    if (this.isUnlocked(path)) return true;

    // A live subscription is ACTIVE / TRIALING / PAST_DUE (PAST_DUE keeps its
    // 7-day grace, matching PlanFeatureGuard). TRIAL_ENDED / EXPIRED / none →
    // locked.
    const live = await this.prisma.subscription.findFirst({
      where: {
        tenantId,
        status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
      },
      select: { id: true },
    });
    if (live) return true;

    throw new ForbiddenException({
      statusCode: 403,
      error: "Plan Selection Required",
      errorCode: "PLAN_SELECTION_REQUIRED",
      message: "Deneme süreniz sona erdi. Devam etmek için bir plan seçin.",
    });
  }

  /**
   * Segment-aware prefix match against the request path (which carries the
   * /api global prefix). "/me" matches "/api/users/me" and "/api/me" but NOT
   * "/api/menu" — the same boundary rule the SPA's isTenantWidePath uses.
   */
  private isUnlocked(path: string): boolean {
    return SubscriptionStatusGuard.UNLOCKED_PREFIXES.some((prefix) => {
      const idx = path.indexOf(prefix);
      if (idx === -1) return false;
      const after = path.charAt(idx + prefix.length);
      return after === "" || after === "/";
    });
  }
}
