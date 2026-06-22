import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { PartnerApiKeyService } from "../partner-api-key.service";
import { EntitlementService } from "../../entitlements/entitlement.service";
import { PrismaService } from "../../../prisma/prisma.service";

const LIVE_SUBSCRIPTION_STATUSES = ["ACTIVE", "TRIALING", "PAST_DUE"];

/**
 * Authenticates a partner backend by its API key (bearer secret over TLS):
 *   X-Partner-Key:    <keyId>     (public id)
 *   X-Partner-Secret: <secret>    (shown once at issuance; sha256-compared)
 *
 * On success sets req.partnerKey (the key row) + req.machinePrincipalId.
 *
 * This is the single choke point for the partner realm, so it also enforces
 * BOTH subscription liveness AND the EXTERNAL_DISPLAY feature — @MachineAuth
 * makes the global SubscriptionStatusGuard / PlanFeatureGuard step aside
 * (no req.user), so without these checks an EXPIRED/TRIAL_ENDED tenant could
 * keep minting tokens. Feature resolution mirrors PlanFeatureGuard EXACTLY
 * (engine grants → else featureOverrides → else currentPlan flag) so the
 * create-key path (PlanFeatureGuard) and this mint path can never disagree
 * during the entitlement-projector warmup window.
 */
@Injectable()
export class PartnerKeyGuard implements CanActivate {
  constructor(
    private readonly keys: PartnerApiKeyService,
    private readonly entitlements: EntitlementService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const keyId = req.headers?.["x-partner-key"];
    const secret = req.headers?.["x-partner-secret"];
    if (!keyId || !secret) {
      throw new UnauthorizedException(
        "Missing X-Partner-Key / X-Partner-Secret",
      );
    }

    const key = await this.keys.authenticate(String(keyId), String(secret));
    if (!key) {
      throw new UnauthorizedException("Invalid partner credentials");
    }

    // Synchronous subscription-liveness gate (mirrors SubscriptionStatusGuard +
    // PlanFeatureGuard) so the partner realm locks the instant a subscription
    // stops being live, not after entitlement-projection convergence.
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: key.tenantId },
      include: { currentPlan: true },
    });
    if (!tenant || !tenant.currentPlan) {
      throw new ForbiddenException("No active subscription plan found");
    }
    const liveSubscription = await this.prisma.subscription.findFirst({
      where: {
        tenantId: key.tenantId,
        status: { in: LIVE_SUBSCRIPTION_STATUSES },
      },
      select: { id: true },
    });
    if (!liveSubscription) {
      throw new ForbiddenException(
        "Your subscription is not active. Please renew to use the Partner Display API.",
      );
    }

    // Feature resolution identical to PlanFeatureGuard: trust the engine when
    // it has any grants for the tenant, else fall back to override → plan flag
    // (the projector-warmup path the create-key guard already relies on).
    const set = await this.entitlements.getForTenant(key.tenantId, null);
    const hasAnyEngineGrants = Object.keys(set.features).length > 0;
    const featureOverrides = tenant.featureOverrides as Record<
      string,
      boolean
    > | null;
    const featureEnabled = hasAnyEngineGrants
      ? set.features["feature.externalDisplay"] === true
      : (featureOverrides?.externalDisplay ??
          (tenant.currentPlan as any).externalDisplay) === true;
    if (!featureEnabled) {
      throw new ForbiddenException(
        "The externalDisplay feature is not enabled for this tenant",
      );
    }

    req.partnerKey = key;
    req.machinePrincipalId = `pk:${key.keyId}`;
    return true;
  }
}
