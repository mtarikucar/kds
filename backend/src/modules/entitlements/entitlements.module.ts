import {
  Global,
  Module,
  OnApplicationBootstrap,
  OnModuleInit,
  Logger,
} from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { DomainEventBus } from "../outbox/domain-event-bus.service";
import { OutboxService } from "../outbox/outbox.service";
import {
  EventTypes,
  SubscriptionLifecyclePayload,
  TenantOverridesChangedPayload,
  AddOnLifecyclePayload,
} from "../outbox/event-types";
import { EntitlementsController } from "./entitlements.controller";
import { InternalEntitlementsController } from "./internal-entitlements.controller";
import { EntitlementService } from "./entitlement.service";
import { EntitlementGuard } from "./entitlement.guard";
import { PlanProjectorService } from "./plan-projector.service";
import { EntitlementInvalidationBus } from "./entitlement-invalidation.bus";

/**
 * The entitlement engine ships as a leaf module — no inbound deps from
 * downstream services. Projectors (plan, add-on, override) call into
 * EntitlementService directly; guards consume it via DI. Keeping this module
 * dependency-free upstream makes it trivial to import from any other module
 * that needs gating, including future modules like `device-mesh`, `fiscal`,
 * `marketplace`.
 *
 * v2.8.99.1 — @Global() so PlanFeatureGuard can be instantiated in any
 * module that uses @UseGuards(PlanFeatureGuard) without that module
 * having to chase the EntitlementService transitive import. The
 * staging v2.8.91/93/96 etc. deploys were crashing at boot because
 * SettingsModule (which @UseGuards-binds PlanFeatureGuard on
 * IntegrationsController) didn't import EntitlementsModule:
 *   Nest can't resolve dependencies of the PlanFeatureGuard
 *   (Reflector, PrismaService, ?). … argument EntitlementService
 *   at index [2] is available in the SettingsModule context.
 * Other modules (orders, menu, tables, reports, analytics) hit the
 * same pattern but the DI graph short-circuited on SettingsModule
 * first. Promoting EntitlementsModule to @Global() closes all six
 * gaps in one shot.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [EntitlementsController, InternalEntitlementsController],
  providers: [
    EntitlementService,
    EntitlementGuard,
    PlanProjectorService,
    EntitlementInvalidationBus,
  ],
  exports: [EntitlementService, EntitlementGuard, PlanProjectorService],
})
export class EntitlementsModule
  implements OnApplicationBootstrap, OnModuleInit
{
  private readonly logger = new Logger(EntitlementsModule.name);

  constructor(
    private readonly projector: PlanProjectorService,
    private readonly bus: DomainEventBus,
    private readonly entitlements: EntitlementService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Subscribe to the lifecycle events that should trigger a reprojection.
   *
   * Listeners are intentionally generic — they just call projectTenant.
   * Producers (SubscriptionService, marketplace, super-admin override UI)
   * write to the outbox; the worker delivers; the projector reconciles.
   *
   * Failure handling: since iter-14, DomainEventBus.dispatch wraps each
   * listener in try/catch and logs without rethrowing — so a throw here
   * does NOT bubble back to the outbox worker for retry. The actual
   * safety net for a missed reprojection is the nightly reconcile cron
   * at 03:15 UTC (plan-projector.service.ts#reconcileNightly), which
   * walks every tenant and reprojects from scratch. A missed activation
   * therefore self-heals within ~24h. The logger.warn below is what
   * surfaces it before then.
   *
   * After reprojection we emit FeatureEntitlementChanged so UI/realtime
   * channels can refresh — kept in this module so producers never need
   * to know about it.
   */
  onModuleInit(): void {
    const reproject = async (tenantId: string, reason: string) => {
      try {
        await this.projector.projectTenant(tenantId);
        this.logger.debug(`Reprojected tenant=${tenantId} reason=${reason}`);
        const set = await this.entitlements.getForTenant(tenantId);
        await this.outbox.append({
          type: EventTypes.FeatureEntitlementChanged,
          tenantId,
          payload: {
            tenantId,
            features: set.features,
            limits: set.limits,
            integrations: set.integrations,
          },
        });
      } catch (e) {
        // Logged for ops visibility; nightly reconcile is the retry.
        // Do NOT rethrow — the bus already swallows, and tossing here
        // just produces a confusing "unhandled rejection caught" line.
        this.logger.warn(
          `Reprojection failed tenant=${tenantId} reason=${reason}: ${(e as Error).message}`,
        );
      }
    };

    const subLifecycle = async (event: { payload: unknown }) => {
      const p = event.payload as SubscriptionLifecyclePayload;
      if (p?.tenantId) await reproject(p.tenantId, "subscription");
    };

    this.bus.on(EventTypes.SubscriptionActivated, subLifecycle);
    this.bus.on(EventTypes.SubscriptionUpgraded, subLifecycle);
    this.bus.on(EventTypes.SubscriptionDowngraded, subLifecycle);
    this.bus.on(EventTypes.SubscriptionCancelled, subLifecycle);

    this.bus.on(EventTypes.TenantOverridesChanged, async (event) => {
      const p = event.payload as TenantOverridesChangedPayload;
      if (p?.tenantId) await reproject(p.tenantId, "override");
    });

    const addOn = async (event: { payload: unknown }) => {
      const p = event.payload as AddOnLifecyclePayload;
      if (p?.tenantId) await reproject(p.tenantId, "addon");
    };
    this.bus.on(EventTypes.AddOnPurchased, addOn);
    this.bus.on(EventTypes.AddOnCancelled, addOn);
  }

  /**
   * One-shot backfill on first boot after the migration lands. Subsequent
   * boots find rows already present and skip — the work happens once.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.projector.backfillMissing();
    } catch (e) {
      this.logger.error(
        `Entitlement backfill failed at bootstrap: ${(e as Error).message}`,
      );
    }
  }
}
