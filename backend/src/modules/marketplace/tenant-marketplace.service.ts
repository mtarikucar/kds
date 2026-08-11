import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";
import { EventTypes } from "../outbox/event-types";
import { AddOnCatalogService } from "./addon-catalog.service";
import { EntitlementService } from "../entitlements/entitlement.service";
import { EntitlementSet } from "../entitlements/entitlement.types";
import { INTEGRATION_COVERED_BY_FEATURE } from "../entitlements/integration-coverage";
import { featureKey } from "../entitlements/entitlement-keys.const";
import { LicensingService } from "../licensing/licensing.service";

/** `feature.license` — the grant that marks a live annual licence. */
const LICENSE_FEATURE_KEY = featureKey("license");

/**
 * Tenant-facing operations: purchase, cancel, list-mine.
 *
 * Purchase is **provisioning-only** here — it creates the TenantAddOn row,
 * emits AddOnPurchased on the outbox, and trusts the entitlement projector
 * to fold in the new grants. Payment is collected upstream: the only
 * caller that grants a PAID add-on is CheckoutService.confirmAndProvision,
 * which runs after the PayTR webhook settles and passes the settled
 * paymentRef. As a hard guard (deep-review C2) purchase() refuses to grant
 * any add-on with priceCents > 0 unless a paymentRef is supplied, so a
 * free grant cannot be minted even if a future caller forgets to route
 * through checkout. Only zero-priced add-ons may be provisioned for free.
 *
 * Dependency check rule: every entry in `deps` is a bare catalog code and
 * must match a currently-ACTIVE TenantAddOn row for the tenant. The pre-3.3
 * `plan:<NAME>` form is retired along with plans themselves — the catalog
 * validator rejects it at write time, and any that survive in old data are
 * treated as unsatisfiable, which is the truth.
 */
@Injectable()
export class TenantMarketplaceService {
  private readonly logger = new Logger(TenantMarketplaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: AddOnCatalogService,
    private readonly outbox: OutboxService,
    private readonly entitlements: EntitlementService,
    private readonly licensing: LicensingService,
  ) {}

  /**
   * Tenant-aware marketplace catalogue: the published add-ons, each annotated
   * with `includedInPlan` — true when the add-on's grants are ALREADY satisfied
   * by the tenant's effective entitlements (plan + existing add-ons + overrides),
   * so the storefront can show "included in your plan" instead of trying to sell
   * a feature the tenant already has.
   *
   * Grants stay server-side (the public projection deliberately omits them, see
   * AddOnCatalogService.listPublic); we only emit the boolean.
   */
  async listAvailable(tenantId: string, kind?: string) {
    const [rows, ent] = await Promise.all([
      this.prisma.marketplaceAddOn.findMany({
        where: { status: "published", ...(kind ? { kind } : {}) },
        orderBy: [{ kind: "asc" }, { name: "asc" }],
      }),
      this.entitlements.getForTenant(tenantId),
    ]);
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      description: r.description,
      kind: r.kind,
      billing: r.billing,
      priceCents: r.priceCents,
      currency: r.currency,
      deps: r.deps,
      includedInPlan: TenantMarketplaceService.isIncludedInEntitlements(
        r.grants as Record<string, unknown> | null,
        ent,
      ),
    }));
  }

  /**
   * True when EVERY grant an add-on provides is already covered by the tenant's
   * entitlement set — i.e. buying it would add nothing.
   *
   * Rules (keys are the same prefixed namespace on both sides, e.g.
   * "feature.reservationSystem", "limit.kdsScreens", "integration.delivery"):
   *  - A `limit.*` grant is ADDITIVE capacity (an extra branch/screen/tablet) —
   *    you can always buy more, so an add-on carrying ANY limit grant is never
   *    "included" (stays purchasable). This also covers mixed grants like
   *    extra_branch ({ "limit.maxBranches": 1, "feature.multiLocation": true }).
   *  - A `feature.X: true` grant is covered iff features[X] is already true.
   *  - An `integration.domain: [vendors]` grant is covered iff EITHER (a) a
   *    plan-feature covers the whole domain (DEF-3 — see
   *    INTEGRATION_COVERED_BY_FEATURE: PlanProjectorService never projects
   *    `integration.*` for plan-sourced access, only `feature.*`, so a
   *    tenant whose PLAN includes e.g. delivery would otherwise never show
   *    as covered no matter how the vendor-list check is written), OR (b)
   *    every vendor is already present in integrations[domain].
   *  - An add-on with NO grants (e.g. a one-time on-site service) is never
   *    "included" — there's nothing for the plan to cover.
   */
  static isIncludedInEntitlements(
    grants: Record<string, unknown> | null | undefined,
    ent: EntitlementSet,
  ): boolean {
    const entries = Object.entries(grants ?? {});
    if (entries.length === 0) return false;
    for (const [key, value] of entries) {
      if (key === LICENSE_FEATURE_KEY) {
        // The licence is a TERM product, not a capability the tenant either
        // has or doesn't. Treating "you already hold a licence" as "included"
        // would mark it covered the moment it is bought and make it
        // unsellable — including at renewal, which is exactly when it must be
        // buyable. Never redundant.
        return false;
      }
      if (key.startsWith("limit.")) {
        // Additive capacity — never redundant.
        return false;
      }
      if (key.startsWith("feature.")) {
        // Only a granted (true) feature needs covering; a false grant is a
        // no-op and doesn't block inclusion.
        if (value === true && ent.features?.[key] !== true) return false;
      } else if (key.startsWith("integration.")) {
        const domain = key.slice("integration.".length);
        const coveringFeature = INTEGRATION_COVERED_BY_FEATURE[domain];
        if (
          coveringFeature &&
          ent.features?.[`feature.${coveringFeature}`] === true
        ) {
          // DEF-3: the tenant's PLAN already covers this whole domain —
          // no need to check the (always-empty, for plan-sourced access)
          // vendor list.
          continue;
        }
        const have = ent.integrations?.[key] ?? [];
        // "*" is the engine's "all vendors permitted" wildcard (see
        // entitlement-engine allowsIntegration) — if the tenant has it, every
        // vendor this add-on grants is already covered.
        if (have.includes("*")) continue;
        const want = Array.isArray(value) ? (value as string[]) : [];
        if (!want.every((v) => have.includes(v))) return false;
      } else {
        // Unknown grant namespace — can't prove coverage, treat as purchasable.
        return false;
      }
    }
    return true;
  }

  async purchase(
    tenantId: string,
    input: {
      addOnCode: string;
      quantity?: number;
      branchId?: string;
      paymentRef?: string;
      /** Prorated amount actually charged, in kuruş. Snapshot for the invoice. */
      chargedCents?: number;
      /** { annualPriceCents, proratedDays, cycleDays, mode } from the quote. */
      pricingMeta?: Record<string, unknown>;
      /** Anniversary-aligned period from the priced line. */
      periodStart?: Date;
      periodEnd?: Date;
    },
    // When supplied (checkout/PayTR settlement), the grant joins the caller's
    // transaction so it rolls back atomically with the rest of the cart instead
    // of committing on a separate connection.
    callerTx?: Prisma.TransactionClient,
    /**
     * Operator comp. The documented way to hand a tenant a product for free —
     * NOT `Tenant.featureOverrides`, which projects `{__replace:false}` for
     * every key it carries and would permanently suppress a product the
     * tenant later pays for. A comp is an ordinary ownership row: auditable,
     * expiring on the anniversary like everything else, visible in the
     * tenant's owned list, and incapable of poisoning a future purchase.
     */
    opts?: { comp?: { actorId: string; reason: string } },
  ) {
    const addOn = await this.catalog.findByCodeOrThrow(input.addOnCode);
    // Default-deny: an add-on status the catalog UI doesn't know about
    // (a new lifecycle state added later, a typo in a manual update)
    // must NOT silently mint a TenantAddOn row. Previously the code
    // only blocked 'archived' / 'draft' — anything else fell through
    // to `create`. Allowlist published-only.
    if (addOn.status !== "published") {
      throw new BadRequestException(
        addOn.status === "archived"
          ? "This add-on is no longer available for purchase"
          : addOn.status === "draft"
            ? "This add-on is not yet published"
            : `Add-on is not available for purchase (status=${addOn.status})`,
      );
    }

    // SECURITY (deep-review C2): never mint a PAID add-on without proof of
    // payment. The only legitimate caller that grants a paid add-on is the
    // checkout/PayTR settlement path (CheckoutService.confirmAndProvision),
    // which always passes the settled paymentRef. A paid add-on with no
    // paymentRef is a free grant — reject it here so the service is safe
    // regardless of which controller calls it (defence in depth behind the
    // removal of the tenant-facing free /addons/purchase endpoint). Free
    // add-ons (priceCents === 0) may still be provisioned without payment.
    const isComp = !!opts?.comp;
    if (addOn.priceCents > 0 && !input.paymentRef && !isComp) {
      throw new ForbiddenException(
        `Add-on "${addOn.code}" requires payment; purchase it through checkout.`,
      );
    }

    // Verify deps are satisfied for this specific tenant. Catalog-level
    // resolveDeps only confirms the dep references exist; this is the
    // tenant-specific apply-time check.
    //
    // Deps are bare catalog codes. Checkout's AddonPurchasabilityService runs
    // the same check BEFORE payment and additionally accepts a sibling cart
    // line as satisfying a dep, which is why an opening cart of
    // licence + module + credit pack settles cleanly: CheckoutService
    // provisions in dependency order, so by the time this runs each
    // prerequisite is already an active row.
    if (addOn.deps.length > 0) {
      const activeAddOns = await this.prisma.tenantAddOn.findMany({
        where: { tenantId, status: "active" },
        include: { addOn: { select: { code: true } } },
      });
      const haveAddOnCodes = new Set(activeAddOns.map((ta) => ta.addOn.code));

      const missing = addOn.deps.filter((dep) => !haveAddOnCodes.has(dep));
      if (missing.length > 0) {
        throw new BadRequestException(
          `Add-on requires: ${missing.join(", ")}. Purchase the required products first.`,
        );
      }
    }

    // Credit packs are balances, not entitlements — they mint a CreditLot and
    // never an ownership row. Routing one through here would create a
    // TenantAddOn that grants nothing and renews forever.
    if (addOn.kind === "credit") {
      throw new BadRequestException(
        `"${addOn.code}" is a credit pack — provision it with purchaseCredits().`,
      );
    }

    const qty = input.quantity ?? 1;
    const now = new Date();

    // Annual products run to the tenant's ANNIVERSARY, not to a rolling
    // window, so the whole account renews on one date with one invoice. The
    // caller (checkout) passes the period from the priced line so the charged
    // proration and the provisioned period can never disagree; the fallback
    // resolves it fresh for direct callers such as an operator comp.
    let currentPeriodEnd: Date | null = null;
    let currentPeriodStart = now;
    if (addOn.billing !== "oneTime") {
      if (input.periodEnd) {
        currentPeriodEnd = input.periodEnd;
        currentPeriodStart = input.periodStart ?? now;
      } else {
        const ctx = await this.licensing.loadContext(tenantId, now);
        const priced = this.licensing.price(ctx, addOn.priceCents);
        currentPeriodEnd = priced.periodEnd;
        currentPeriodStart = priced.periodStart;
      }
    }

    const ownershipMeta = {
      chargedCents: isComp ? 0 : (input.chargedCents ?? null),
      currency: addOn.currency,
      pricingMeta: (input.pricingMeta ?? null) as Prisma.InputJsonValue | null,
      origin: isComp ? "comp" : "purchase",
      compReason: opts?.comp?.reason ?? null,
      compActorId: opts?.comp?.actorId ?? null,
    };

    // Wrap the idempotency-check, dup-check, and create in a SERIALIZABLE
    // transaction. The TenantAddOn table has no partial unique index on
    // (tenantId, addOnId, branchId) where status='active' — adding one
    // requires a raw-SQL migration. Until then Serializable isolation is
    // the only Prisma-level guard against the write-skew anomaly: two
    // concurrent purchases both read empty on the dup-check, both write,
    // and the entitlement projector stacks two grants — effectively
    // doubling the capacity limit for free. Postgres detects the
    // overlapping read/write predicate sets and aborts one transaction;
    // the loser surfaces as a 409 the client can retry, which then sees
    // the now-committed first purchase.
    // Core write: idempotency-check + dup-guard + create + outbox emit, all on
    // ONE client. Folding the AddOnPurchased emit into the same transaction
    // closes the crash window where a committed grant had no projector event
    // (mirrors cancel()); NO .catch on the emit so a failed append rolls the
    // grant back rather than leaving an entitlement the projector never saw.
    const core = async (tx: Prisma.TransactionClient) => {
      // Idempotency by paymentRef — a webhook replay returns the prior row
      // WITHOUT re-emitting.
      if (input.paymentRef) {
        const existing = await tx.tenantAddOn.findFirst({
          where: { tenantId, paymentRef: input.paymentRef },
        });
        if (existing) return existing;
      }

      // RE-PAYMENT / RENEWAL (manual-renewal model). A recurring add-on whose
      // period lapsed sits in 'past_due' (grace) or 'expired' (revoked). The
      // operator renews by paying again through the SAME checkout → PayTR →
      // confirmAndProvision rail — there is no card vault, so we never
      // auto-charge. Rather than minting a duplicate row (which would orphan
      // the lapsed one and break the (tenant,addOn,branch) identity the dup-
      // guard relies on), reactivate the existing row in place: reset the
      // period, status → active, attach the new paymentRef. Mirrors the
      // Subscription PAST_DUE/EXPIRED → ACTIVE renewal that reuses the row.
      // Pick the most-recently-activated lapsed row for this identity.
      const renewable = await tx.tenantAddOn.findFirst({
        where: {
          tenantId,
          addOnId: addOn.id,
          branchId: input.branchId ?? null,
          status: { in: ["past_due", "expired"] },
        },
        orderBy: { activatedAt: "desc" },
      });
      if (renewable) {
        const reactivated = await tx.tenantAddOn.update({
          where: { id: renewable.id },
          data: {
            status: "active",
            // A renewal honours any pending capacity downgrade the tenant
            // scheduled; otherwise it keeps what they had.
            quantity: renewable.pendingQuantity ?? qty,
            pendingQuantity: null,
            activatedAt: now,
            currentPeriodStart,
            currentPeriodEnd,
            cancelAtPeriodEnd: false,
            cancelledAt: null,
            endedAt: null,
            paymentRef: input.paymentRef ?? null,
            ...ownershipMeta,
          },
        });
        await this.stampLicenceAnchor(tx, tenantId, addOn.kind, now);
        await this.outbox.append(
          {
            type: EventTypes.AddOnPurchased,
            tenantId,
            payload: {
              tenantId,
              addOnId: reactivated.id,
              addOnCode: addOn.code,
              branchId: input.branchId ?? null,
              quantity: qty,
            },
          },
          tx,
        );
        return reactivated;
      }

      // Tenant-scope duplicate guard.
      const dup = await tx.tenantAddOn.findFirst({
        where: {
          tenantId,
          addOnId: addOn.id,
          branchId: input.branchId ?? null,
          status: "active",
        },
      });
      if (dup) {
        // CAPACITY is quantity-based: buying a third branch when you own two
        // must ADD one, not fail. Pre-3.3 this threw "change quantity
        // instead" and pointed at a path that did not exist, which made
        // capacity unsellable past a single unit. Already-paid units are
        // never re-prorated — only the delta was charged — so the history
        // entry records what this increment actually cost.
        if (addOn.kind === "capacity") {
          const history = Array.isArray(
            (dup.pricingMeta as any)?.quantityHistory,
          )
            ? (dup.pricingMeta as any).quantityHistory
            : [];
          const bumped = await tx.tenantAddOn.update({
            where: { id: dup.id },
            data: {
              quantity: { increment: qty },
              paymentRef: input.paymentRef ?? dup.paymentRef,
              chargedCents:
                (dup.chargedCents ?? 0) + (ownershipMeta.chargedCents ?? 0),
              pricingMeta: {
                ...((dup.pricingMeta as any) ?? {}),
                ...((input.pricingMeta as any) ?? {}),
                quantityHistory: [
                  ...history,
                  {
                    at: now.toISOString(),
                    from: dup.quantity,
                    to: dup.quantity + qty,
                    chargedCents: ownershipMeta.chargedCents ?? 0,
                    paymentRef: input.paymentRef ?? null,
                  },
                ],
              } as Prisma.InputJsonValue,
            },
          });
          await this.outbox.append(
            {
              type: EventTypes.AddOnPurchased,
              tenantId,
              payload: {
                tenantId,
                addOnId: bumped.id,
                addOnCode: addOn.code,
                branchId: input.branchId ?? null,
                quantity: bumped.quantity,
              },
            },
            tx,
          );
          return bumped;
        }

        throw new BadRequestException(
          `Add-on "${addOn.code}" is already active for this ${input.branchId ? "branch" : "tenant"}.`,
        );
      }

      const created = await tx.tenantAddOn.create({
        data: {
          tenantId,
          addOnId: addOn.id,
          branchId: input.branchId,
          quantity: qty,
          status: "active",
          activatedAt: now,
          currentPeriodStart,
          currentPeriodEnd,
          paymentRef: input.paymentRef ?? null,
          ...ownershipMeta,
        },
      });

      await this.stampLicenceAnchor(tx, tenantId, addOn.kind, now);

      await this.outbox.append(
        {
          type: EventTypes.AddOnPurchased,
          tenantId,
          payload: {
            tenantId,
            addOnId: created.id,
            addOnCode: addOn.code,
            branchId: input.branchId ?? null,
            quantity: qty,
          },
        },
        tx,
      );

      return created;
    };

    // Joined path: the caller (checkout) owns the transaction + serialization.
    if (callerTx) {
      return core(callerTx);
    }

    // Standalone path (superadmin comp / direct): own Serializable transaction.
    // The table lacks a partial unique index on (tenantId, addOnId, branchId)
    // where status='active', so Serializable is the guard against the
    // double-grant write-skew; the loser surfaces as a retryable 409.
    try {
      return await this.prisma.$transaction(core, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2034"
      ) {
        throw new ConflictException(
          "Concurrent purchase detected — please retry. Your request did not double-charge.",
        );
      }
      throw err;
    }
  }

  /**
   * Stamp the tenant's anniversary anchor the first time they are licensed.
   *
   * No-op for every other product kind, and no-op on renewal — the update is
   * scoped to `licenseAnchorAt: null`. That "write once" property is the
   * entire reason the anchor lives on Tenant instead of on the ownership row:
   * `purchase()` rewrites `activatedAt` on every renewal, so an anchor
   * derived from it would drift forward each time a customer paid late.
   */
  private async stampLicenceAnchor(
    tx: Prisma.TransactionClient,
    tenantId: string,
    kind: string,
    now: Date,
  ): Promise<void> {
    if (kind !== "license") return;
    const ctx = await this.licensing.loadContext(tenantId, now);
    await this.licensing.stampAnchorIfAbsent(
      tx,
      tenantId,
      this.licensing.resolveAnchorFor(ctx),
    );
  }

  /**
   * Provision a prepaid credit pack.
   *
   * Deliberately separate from `purchase()`: credits are a BALANCE, not an
   * entitlement. They create no ownership row, never renew, and are read live
   * inside the advisory-locked consumption transaction rather than from the
   * 30-second entitlement cache — a stale balance during a burst would be a
   * real money bug (one 3D generation is a ~₺12 vendor charge).
   *
   * Idempotent on (tenantId, paymentRef, addOnCode) so an aggressive PayTR
   * webhook retry cannot double-grant.
   */
  async purchaseCredits(
    tenantId: string,
    input: {
      addOnCode: string;
      quantity?: number;
      paymentRef?: string;
      chargedCents?: number;
    },
    callerTx?: Prisma.TransactionClient,
    opts?: { comp?: { actorId: string; reason: string } },
  ) {
    const addOn = await this.catalog.findByCodeOrThrow(input.addOnCode);
    if (addOn.kind !== "credit") {
      throw new BadRequestException(`"${addOn.code}" is not a credit pack.`);
    }
    if (addOn.status !== "published" && !opts?.comp) {
      throw new BadRequestException(
        `Credit pack "${addOn.code}" is not available for purchase.`,
      );
    }
    if (!addOn.creditKind || !addOn.creditUnits) {
      throw new BadRequestException(
        `Credit pack "${addOn.code}" is misconfigured: no creditKind/creditUnits.`,
      );
    }
    const isComp = !!opts?.comp;
    if (addOn.priceCents > 0 && !input.paymentRef && !isComp) {
      throw new ForbiddenException(
        `Credit pack "${addOn.code}" requires payment; purchase it through checkout.`,
      );
    }

    const qty = input.quantity ?? 1;
    const units = addOn.creditUnits * qty;
    const source = isComp
      ? `comp:admin:${opts!.comp!.actorId}`
      : `purchase:${addOn.code}`;

    const write = async (tx: Prisma.TransactionClient) => {
      // The unique index is (tenantId, paymentRef, addOnCode). A comp has no
      // paymentRef, so two comps of the same pack are both allowed — which is
      // correct: an operator granting credits twice means twice the credits.
      if (input.paymentRef) {
        const existing = await tx.creditLot.findFirst({
          where: {
            tenantId,
            paymentRef: input.paymentRef,
            addOnCode: addOn.code,
          },
        });
        if (existing) return existing;
      }
      return tx.creditLot.create({
        data: {
          tenantId,
          kind: addOn.creditKind!,
          units,
          source,
          addOnCode: addOn.code,
          paymentRef: input.paymentRef ?? null,
          priceCents: isComp
            ? 0
            : (input.chargedCents ?? addOn.priceCents * qty),
          currency: addOn.currency,
        },
      });
    };

    const lot = callerTx ? await write(callerTx) : await write(this.prisma);
    this.logger.log(
      `Credits granted: tenant=${tenantId} kind=${addOn.creditKind} units=${units} source=${source}`,
    );
    return lot;
  }

  async cancel(tenantId: string, tenantAddOnId: string, immediate = false) {
    const row = await this.prisma.tenantAddOn.findFirst({
      where: { id: tenantAddOnId, tenantId },
    });
    if (!row) throw new NotFoundException("Add-on not found for this tenant");
    // Cancellable from 'active' (normal) or 'past_due' (the operator opts not
    // to renew a lapsed recurring add-on). A past_due row's paid period has
    // already ended, so cancellation is always immediate for it — there is no
    // remaining period to honour, and leaving it cancelAtPeriodEnd would keep
    // the grace grant live with no path to revoke before grace expiry.
    if (row.status !== "active" && row.status !== "past_due")
      throw new BadRequestException(`Cannot cancel — status is ${row.status}`);
    const effectiveImmediate = immediate || row.status === "past_due";

    const now = new Date();
    // v2.8.96 — fold claim + post-fetch + emit into one transaction.
    // Pre-fix the emit ran AFTER the updateMany commit; a process
    // crash between commit and emit left the add-on cancelled with no
    // projector signal, so the granted limits/features stayed live
    // until the next reconcile cron caught it.
    //
    // Compound WHERE (B41-B45 pattern, iter-31 onward) + status gate so two
    // concurrent cancel calls converge on a single transition. The previous
    // shape (.update by id) accepted the second writer too and would
    // double-emit the AddOnCancelled outbox event; the count check below
    // makes the loser explicit. The claim's status filter pins the exact
    // state we read so a concurrent renewal (past_due → active) or sweep
    // (past_due → expired) makes us a clean no-op.
    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.tenantAddOn.updateMany({
        where: { id: tenantAddOnId, tenantId, status: row.status },
        data: effectiveImmediate
          ? {
              status: "cancelled",
              cancelledAt: now,
              endedAt: now,
              cancelAtPeriodEnd: false,
            }
          : { cancelAtPeriodEnd: true, cancelledAt: now },
      });
      if (claim.count === 0) {
        throw new BadRequestException(
          "Cancel raced with another request — refresh and retry",
        );
      }
      const updated = await tx.tenantAddOn.findFirstOrThrow({
        where: { id: tenantAddOnId, tenantId },
      });

      // Immediate cancellation revokes entitlements right away. At-period-end
      // cancellation leaves the row active until the nightly sweep / billing
      // cycle close transitions it.
      if (effectiveImmediate) {
        // Emit INSIDE the tx with NO .catch — a failed append must roll the
        // cancellation back (mirrors purchase()), otherwise the row flips to
        // cancelled with no projector signal and the granted limits/features
        // stay live until the next reconcile.
        await this.outbox.append(
          {
            type: EventTypes.AddOnCancelled,
            tenantId,
            payload: {
              tenantId,
              addOnId: row.id,
              addOnCode: "<lookup>", // intentionally elided — projector reads canonical state
            },
          },
          tx,
        );
      }
      return updated;
    });
  }

  async listMine(tenantId: string) {
    return this.prisma.tenantAddOn.findMany({
      where: { tenantId },
      include: { addOn: true },
      orderBy: { activatedAt: "desc" },
    });
  }
}
