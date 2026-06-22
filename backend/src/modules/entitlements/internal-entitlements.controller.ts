import { Controller, HttpCode, Post, UseGuards, Logger } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { ApiExcludeController } from "@nestjs/swagger";
import { Public } from "../auth/decorators/public.decorator";
import { InternalServiceTokenGuard } from "../../common/guards/internal-service-token.guard";
import { PlanProjectorService } from "./plan-projector.service";

/**
 * Internal maintenance surface for the entitlement engine — service-to-service
 * only, NOT for browsers or the marketing peer's normal traffic.
 *
 * The single endpoint, POST /api/internal/entitlements/reproject-all, exists so
 * the deploy pipeline can re-run the "reproject every tenant" sweep right after
 * `prisma migrate deploy` lands a schema change. When a migration adds a new
 * Boolean feature column to SubscriptionPlan, existing tenants already have
 * FeatureEntitlement rows, so the on-boot backfill (which skips tenants that
 * already have ANY row) does NOT pick the new flag up — only a full reprojection
 * does. That gap is exactly what hid the externalDisplay "Partner API Keys" page
 * for existing tenants in v3.2.32; scripts/deploy.sh now calls this endpoint so
 * a feature migration surfaces immediately instead of waiting up to ~24h for the
 * 03:15 UTC nightly reconcile.
 *
 * Auth mirrors InternalProvisioningController EXACTLY:
 *   - @Public() opts out of the global tenant-JWT pipeline (which would 401
 *     before the service-token check could run);
 *   - @SkipThrottle() because this is machine traffic, not a browser;
 *   - @UseGuards(InternalServiceTokenGuard) requires the shared
 *     INTERNAL_SERVICE_TOKEN in the `x-internal-token` header (503 when the
 *     secret is unset so the caller can tell "not configured" from "wrong
 *     token", 401 on a missing/mismatched token);
 *   - @ApiExcludeController() keeps it out of the public Swagger doc.
 */
@ApiExcludeController()
@Controller("internal/entitlements")
@Public()
@SkipThrottle()
@UseGuards(InternalServiceTokenGuard)
export class InternalEntitlementsController {
  private readonly logger = new Logger(InternalEntitlementsController.name);

  constructor(private readonly planProjector: PlanProjectorService) {}

  /**
   * Reproject EVERY tenant's entitlements (advisory-locked + idempotent via
   * PlanProjectorService.reconcileNightly — the same sweep the nightly cron
   * runs). Returns `{ ok: true }` once the sweep completes so the deploy can
   * gate on a 2xx + body.
   */
  @Post("reproject-all")
  @HttpCode(200)
  async reprojectAll(): Promise<{ ok: true }> {
    this.logger.log("Reprojecting all tenants (deploy-triggered)");
    await this.planProjector.reconcileNightly();
    this.logger.log("Reproject-all complete");
    return { ok: true };
  }
}
