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
      select: { id: true },
    });
    if (!tenant) {
      throw new ForbiddenException("Tenant not found");
    }

    // v3.3.0 — one source of truth. The pre-3.3 shape required a live
    // SUBSCRIPTION and then fell back through featureOverrides to a plan
    // column when the engine looked empty. None of those exist any more:
    // access is decided by the folded entitlement set, which already carries
    // the free baseline, every owned product, the licence suppression rule and
    // any admin override.
    const set = await this.entitlements.getForTenant(key.tenantId, null);
    if (set.features["feature.externalDisplay"] !== true) {
      throw new ForbiddenException(
        "The externalDisplay feature is not enabled for this tenant",
      );
    }

    req.partnerKey = key;
    req.machinePrincipalId = `pk:${key.keyId}`;
    return true;
  }
}
