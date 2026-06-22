import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { PartnerApiKeyService } from "../partner-api-key.service";
import { EntitlementService } from "../../entitlements/entitlement.service";

/**
 * Authenticates a partner backend by its API key (bearer secret over TLS):
 *   X-Partner-Key:    <keyId>     (public id)
 *   X-Partner-Secret: <secret>    (shown once at issuance; sha256-compared)
 *
 * On success sets req.partnerKey (the key row) + req.machinePrincipalId. Also
 * enforces the EXTERNAL_DISPLAY plan feature here — the global PlanFeatureGuard
 * can't, because machine routes carry no req.user.tenantId.
 */
@Injectable()
export class PartnerKeyGuard implements CanActivate {
  constructor(
    private readonly keys: PartnerApiKeyService,
    private readonly entitlements: EntitlementService,
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

    const set = await this.entitlements.getForTenant(key.tenantId, null);
    if (set?.features?.["feature.externalDisplay"] !== true) {
      throw new ForbiddenException(
        "The externalDisplay feature is not enabled for this tenant",
      );
    }

    req.partnerKey = key;
    req.machinePrincipalId = `pk:${key.keyId}`;
    return true;
  }
}
