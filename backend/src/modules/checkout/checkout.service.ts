import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { MetricsService } from "../../common/metrics/metrics.service";
import { OutboxService } from "../outbox/outbox.service";
import { CatalogService } from "../catalog/catalog.service";
import { TenantMarketplaceService } from "../marketplace/tenant-marketplace.service";
import { TenantInvoiceService } from "./tenant-invoice.service";
import { EventTypes } from "../outbox/event-types";
import { DeviceService } from "../device-mesh/device.service";
import { Cart, CartQuote } from "./checkout.types";
import { QuoteService } from "./quote.service";
import { DemoGuardService } from "../demo/demo-guard.service";

/**
 * Checkout orchestrator — turns a Cart into:
 *   - one HardwareOrder (if cart has hardware/service)
 *   - one or more TenantAddOn provisions (if cart has add-ons)
 *
 * Checkout does NOT handle subscription/plan changes. Those go through the
 * dedicated /subscriptions/change-plan → pendingPlanChange → settlement rail.
 * `type:'plan'` cart lines are rejected up-front by QuoteService, so a plan
 * line can never reach this orchestrator (and never gets charged for a no-op).
 *
 * Provisioning is gated behind `paymentRef`. In MVP, this service is the
 * single entry point both for "paid checkout" (Iyzico/Stripe webhook calls
 * confirm with `paymentRef`) and for "admin-comped checkout" (super-admin
 * forces a complete with no paymentRef). The downstream invariants are the
 * same; only the audit trail differs.
 *
 * Provisioning is run inside one Prisma transaction so partial state is
 * impossible. Outbox events are appended in the same Tx — they fire only
 * after commit, which is exactly the semantics we want.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly quoteSvc: QuoteService,
    private readonly catalog: CatalogService,
    private readonly tenantMarketplace: TenantMarketplaceService,
    // Itemized à-la-carte invoicing, written inside the provisioning
    // transaction so a granted product can never exist without its invoice.
    private readonly tenantInvoices: TenantInvoiceService,
    // Optional so unit tests constructing the service bare keep working.
    @Optional() private readonly metrics?: MetricsService,
    // Optional: provisions device-mesh slots for purchased device-class
    // hardware (best-effort, post-commit). Bare-constructed tests pass null.
    @Optional() private readonly devices?: DeviceService,
    // Demo-tenant real-money block. REQUIRED (no @Optional) —
    // CheckoutModule imports DemoGuardModule, so DI fails loud at boot if a
    // future module-wiring regression ever drops that import, instead of
    // silently no-op'ing a money guard. The `?` on the type + `?.` at the
    // call site below stay only as belt-and-suspenders (and to keep any
    // bare-`new`-constructed spec compiling).
    private readonly demoGuard?: DemoGuardService,
  ) {}

  /**
   * Per-product commission rate for the marketing-rep ledger.
   *
   * Replaces `SubscriptionPlan.commissionRate`, which is meaningless once
   * plans retire. Falls back to the historical 0.10 default so a catalog row
   * created before the column existed still pays a rep.
   */
  private async resolveCommissionRate(
    tx: Prisma.TransactionClient,
    code: string,
  ): Promise<number> {
    const row = await tx.marketplaceAddOn.findUnique({
      where: { code },
      select: { commissionRate: true },
    });
    return row?.commissionRate ? Number(row.commissionRate) : 0.1;
  }

  /**
   * Re-price the cart at confirm time so the user can't tamper with totals.
   *
   * @param paymentRef gateway-supplied settlement id, or `null` for the
   *   operator-comp path. A null ref SKIPS the settled-CheckoutIntent gate and
   *   provisions the client-supplied `cart` for free, so it is an INTERNAL-ONLY
   *   capability: it is reachable only when the caller ALSO passes
   *   `opts.allowComp === true`. The public POST /v1/checkout/confirm
   *   controller can never set that flag (and already forwards a DTO-validated
   *   non-empty ref), so client input can never reach the comp branch — even
   *   if a future caller forwards an empty/null ref by mistake.
   */
  async confirmAndProvision(
    tenantId: string,
    cart: Cart,
    paymentRef: string | null,
    opts?: { allowComp?: boolean },
  ): Promise<{
    quote: CartQuote;
    hardwareOrderId?: string;
    addOnIds: string[];
  }> {
    // Demo-tenant real-money block — defense-in-depth on confirm. The
    // shared "explore demo" tenant should never provision paid hardware/
    // add-ons even if a paymentRef somehow reached this far (createIntent
    // already blocks it upstream); also blocks the admin-comp path for the
    // demo tenant, which has no legitimate use case. Very first statement.
    await this.demoGuard?.assertNotDemo(tenantId);

    // C1 residual — make the comp trust boundary EXPLICIT, not implicit in the
    // public DTO's @IsNotEmpty. The only ungated (no settled-intent) path is a
    // deliberate operator comp, which an internal caller opts into via
    // allowComp. Any falsy ref WITHOUT that flag — null OR '' that slipped past
    // validation, OR client input a future caller forwarded here — is rejected
    // before we touch the DB, so nothing ever provisions for free by accident.
    if (!paymentRef && !opts?.allowComp) {
      this.logger.warn(
        `Rejected confirmAndProvision for tenant=${tenantId}: empty paymentRef without internal allowComp flag`,
      );
      throw new ForbiddenException(
        "No settled payment was found for this reference",
      );
    }
    // SECURITY (deep-review C1 + verification follow-up): a non-null
    // paymentRef is NOT proof of payment, AND a settled ref must only
    // provision the cart that was actually PAID FOR. The tenant-facing POST
    // /v1/checkout/confirm endpoint is gated only by @Roles(ADMIN, MANAGER) —
    // ordinary tenant-realm roles every restaurant owner holds — and forwards
    // BOTH a client-supplied cart and paymentRef straight here. Two holes if
    // we trust them:
    //   1. Forged ref -> allocate/ship hardware, grant paid add-ons, request a
    //      plan upgrade with ZERO money collected (repeatable per made-up ref).
    //   2. Cart swap   -> pay for a cheap (e.g. plan-only) cart, then /confirm
    //      an EXPENSIVE hardware+add-on cart under the same settled ref. A
    //      plan-only purchase mints no HardwareOrder, so the idempotency guard
    //      below does NOT early-return and the swapped hardware ships for free.
    //
    // The only legitimate way a paymentRef reaches provisioning is through
    // CheckoutSettlementService.handleSuccess (HMAC-authenticated PayTR
    // webhook), which flips the CheckoutIntent 'pending' -> 'succeeded' and
    // passes intent.cartJson. So: require a settled CheckoutIntent for
    // (tenantId, paymentRef), and provision THAT intent's persisted cart —
    // ignoring whatever cart the client sent. A forged ref has no intent row
    // -> rejected; an already-provisioned ref is allowed so idempotent replays
    // still return the cached order below.
    //
    // paymentRef === null is the internal operator-comp path, now explicitly
    // gated above by opts.allowComp (no public caller can reach it).
    let effectiveCart: Cart = cart;
    let chargedAmountCents: number | null = null;
    // Frozen pricing instant, replayed from the settled intent so the
    // re-quote below is deterministic for day-prorated annual lines.
    let pricedAt: Date | undefined;
    // Kept for the provisioning transaction: the referral snapshot it carries
    // is what makes the commission event possible, and renewalCycleId is what
    // lets settlement close out the renewal it paid for.
    let settledIntent: {
      referralCode: string | null;
      referredByMarketingUserId: string | null;
      renewalCycleId: string | null;
    } | null = null;
    if (paymentRef) {
      const intent = await this.prisma.checkoutIntent.findFirst({
        where: { tenantId, paymentRef },
        select: {
          status: true,
          cartJson: true,
          amountCents: true,
          pricedAt: true,
          expiresAt: true,
          referralCode: true,
          referredByMarketingUserId: true,
          renewalCycleId: true,
        },
      });
      if (
        !intent ||
        (intent.status !== "succeeded" && intent.status !== "provisioned")
      ) {
        this.logger.warn(
          `Rejected confirmAndProvision for tenant=${tenantId} ref=${paymentRef}: no settled CheckoutIntent (status=${intent?.status ?? "none"})`,
        );
        throw new ForbiddenException(
          "No settled payment was found for this reference",
        );
      }
      // Provision exactly what was paid for, never the client-supplied cart.
      effectiveCart = intent.cartJson as unknown as Cart;
      // The frozen amount PayTR actually charged (authoritative).
      chargedAmountCents = intent.amountCents;
      // REPLAY the frozen pricing instant. Annual lines are day-prorated, so
      // re-quoting at "now" would legitimately return a different number for
      // an intent that crossed midnight — and the tolerance check below would
      // then refuse to provision a cart the buyer has already paid for, every
      // single night. Passing pricedAt back in makes the comparison
      // deterministic and leaves the check doing what it is actually for:
      // catching a CATALOG price edit between intent and settlement.
      pricedAt = intent.pricedAt ?? undefined;
      // A stale intent settled long after the fact would provision a period
      // that has already ended.
      if (intent.expiresAt && intent.expiresAt.getTime() < Date.now()) {
        this.logger.error(
          `Rejected confirmAndProvision for tenant=${tenantId} ref=${paymentRef}: intent expired at ${intent.expiresAt.toISOString()}`,
        );
        throw new BadRequestException(
          "This checkout has expired; please start a new one.",
        );
      }
      settledIntent = {
        referralCode: intent.referralCode,
        referredByMarketingUserId: intent.referredByMarketingUserId,
        renewalCycleId: intent.renewalCycleId,
      };
    }

    const quote = await this.quoteSvc.quote(effectiveCart, tenantId, {
      now: pricedAt,
    });

    // The cart stores only codes/qty — the re-quote re-reads LIVE prices. If a
    // catalog price changed between intent and settlement, the re-quoted total
    // would differ from what was charged, provisioning at a price the buyer
    // never agreed to. Refuse to provision on divergence and leave the intent
    // 'succeeded' for manual review (settlement's catch keeps it retryable; an
    // operator re-prices or refunds). A 1-cent tolerance absorbs benign
    // rounding.
    if (
      chargedAmountCents !== null &&
      Math.abs(quote.totalCents - chargedAmountCents) > 1
    ) {
      this.logger.error(
        `Checkout amount mismatch for tenant=${tenantId} ref=${paymentRef}: charged ${chargedAmountCents} but re-quote is ${quote.totalCents} ${quote.currency} — refusing to provision (price changed since intent).`,
      );
      throw new BadRequestException(
        "Checkout amount no longer matches the charged total; provisioning halted for review.",
      );
    }

    // Idempotency: webhook retries and double-clicks on the success page
    // both replay confirmAndProvision with the same paymentRef. Without
    // this guard we'd mint a second HardwareOrder, allocate stock twice,
    // and stack add-on grants. paymentRef is null only on the admin-comp
    // path (super-admin force-complete) — that one is operator-driven and
    // we trust the operator not to fire it twice.
    if (paymentRef) {
      const existing = await this.prisma.hardwareOrder.findFirst({
        where: { tenantId, paymentRef },
        include: { items: true },
      });
      if (existing) {
        // Return the cached provisioning summary. The add-on rows for this
        // paymentRef are recoverable via tenant_addons.paymentRef, but the
        // common UI usage is "show me my order" — the id is enough.
        const addOnRows = await this.prisma.tenantAddOn.findMany({
          where: { tenantId, paymentRef },
          select: { id: true },
        });
        this.logger.log(
          `Idempotent confirmAndProvision hit for paymentRef=${paymentRef}`,
        );
        // Self-heal device provisioning: if the original run committed the
        // order but died before its post-commit provisioning hook, this replay
        // (PayTR retries aggressively) re-runs it. No-ops once slots exist.
        await this.provisionDevicesForOrder(
          tenantId,
          existing.branchId,
          existing.id,
          (existing.items ?? []).map((it) => ({
            productId: it.productId,
            sku: it.sku,
            qty: it.qty,
          })),
        );
        return {
          quote,
          hardwareOrderId: existing.id,
          addOnIds: addOnRows.map((r) => r.id),
        };
      }
    }

    const hardwareLines = quote.lines.filter(
      (l) => l.type === "hardware" || l.type === "service",
    );
    const addOnLines = quote.lines.filter((l) => l.type === "addon");

    // v2.8.99.3 — tenant-scoped active-branch validation. The buyer
    // picked a branch in the shipping form; we trust the SPA to copy
    // the branch's address into effectiveCart.shippingAddress (snapshot) but
    // re-validate the branchId here so a forged or stale request
    // can't stamp another tenant's branch onto this HardwareOrder.
    // Archived branches are rejected too — re-activating an archived
    // branch is a deliberate operator action, not something a
    // checkout flow should resurrect by proxy.
    let validatedBranchId: string | null = null;
    if (effectiveCart.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: effectiveCart.branchId, tenantId, status: "active" },
        select: { id: true },
      });
      if (!branch) {
        throw new BadRequestException(
          `branchId ${effectiveCart.branchId} is not an active branch for this tenant`,
        );
      }
      validatedBranchId = branch.id;
    }

    let hardwareOrderId: string | undefined;
    let hardwareTotalCents = 0;
    const addOnIds: string[] = [];

    await this.prisma.$transaction(
      async (tx) => {
        // 1. Hardware order. Service items live on the same order as their
        // companion hardware so the customer sees one invoice for the
        // physical shipment + installation bundle.
        if (hardwareLines.length > 0) {
          // v2.8.87: any on-site service triggers the order-level
          // `installation: requested` flag (so the SuperAdmin fulfilment
          // dashboard surfaces it). Previously this matched only on the
          // legacy 'onsite_install' code prefix; now we read
          // serviceMeta.serviceType set on each service line. Each on-site
          // line also mints its OWN InstallationRequest below — the
          // order-level flag is just a quick filter.
          const onsiteServiceLines = hardwareLines.filter(
            (l) =>
              l.type === "service" &&
              (l.meta?.serviceMeta?.serviceType === "onsite" ||
                // Legacy fallback (the 2 hardcoded codes don't carry
                // serviceMeta from the catalog).
                l.code.startsWith("onsite_install")),
          );
          // Hardware line prices are KDV-INCLUSIVE (gross), like all catalog
          // prices. Persist the invoice breakdown net + embedded-tax + shipping
          // so the row adds up AND its total equals the gross amount actually
          // charged — net + tax + shipping == gross + shipping. (Do NOT add tax
          // on top of the gross; that would re-introduce the 20% overcharge the
          // quote fix removes.) The rate is the quote's embedded ratio
          // (quote.taxCents / quote.subtotalCents == rate, since subtotal is net).
          const hwGross = hardwareLines.reduce(
            (a, l) => a + l.subtotalCents,
            0,
          );
          const rate =
            quote.subtotalCents > 0 ? quote.taxCents / quote.subtotalCents : 0;
          const hwNet = rate > 0 ? Math.round(hwGross / (1 + rate)) : hwGross;
          const hwTax = hwGross - hwNet;
          hardwareTotalCents = hwGross + quote.shippingCents;
          const order = await tx.hardwareOrder.create({
            data: {
              tenantId,
              // v2.8.99.3 — buyer-picked branch (already validated above).
              // Snapshot of which branch this order ships to; the actual
              // address lives in shippingAddress Json and is frozen at
              // create time so a later Branch.address edit can't rewrite
              // history. branchId is for traceability + future
              // "orders shipping to this branch" reports.
              branchId: validatedBranchId,
              status: paymentRef ? "paid" : "pending_payment",
              subtotalCents: hwNet,
              taxCents: hwTax,
              shippingCents: quote.shippingCents,
              totalCents: hardwareTotalCents,
              currency: quote.currency,
              shippingAddress: effectiveCart.shippingAddress as any,
              billingAddress: effectiveCart.billingAddress as any,
              installation: onsiteServiceLines.length > 0 ? "requested" : null,
              paymentRef,
            },
          });
          hardwareOrderId = order.id;

          for (const l of hardwareLines.filter((l) => l.type === "hardware")) {
            const productId = l.meta?.productId as string;
            const acquisition = l.meta?.acquisition ?? "sell";
            // Allocate stock inside the same tx so over-selling is impossible.
            const { serials } = await this.catalog.allocate(
              productId,
              l.qty,
              tx,
            );
            await tx.hardwareOrderItem.create({
              data: {
                id: uuidv7(),
                orderId: order.id,
                productId,
                sku: l.code,
                name: l.name,
                qty: l.qty,
                unitCents: l.unitCents,
                serials,
                acquisition,
              },
            });
          }

          // v2.8.87: one InstallationRequest per on-site service line so
          // each can be scheduled independently (a tenant may buy KDS
          // install for branch A + WiFi survey for branch B in one cart).
          // branchId / preferredDates / notes come from the cart line meta
          // populated at quote time.
          for (const l of onsiteServiceLines) {
            const meta = l.meta ?? {};
            await tx.installationRequest.create({
              data: {
                id: uuidv7(),
                tenantId,
                hwOrderId: order.id,
                branchId: meta.branchId ?? null,
                status: "requested",
                preferredDates:
                  Array.isArray(meta.preferredDates) &&
                  meta.preferredDates.length > 0
                    ? meta.preferredDates.map((d) => new Date(d))
                    : [],
                notes:
                  meta.notes ??
                  `Auto-created from checkout (service: ${l.code})`,
              },
            });
          }
        }

        // 2. Catalog products.
        //
        // ORDER MATTERS, in two independent ways:
        //   - The licence line must be provisioned FIRST. It is what stamps
        //     Tenant.licenseAnchorAt, and every sibling annual line resolves
        //     its period against that anchor. (The priced lines already carry
        //     an explicit periodEnd, so this is belt-and-braces — but a
        //     direct caller without one would silently get a different year.)
        //   - Dependencies must exist before their dependents. An opening
        //     cart is legitimately "licence + AI module + AI credit pack",
        //     and purchase()'s dep check reads ACTIVE ownership rows, so the
        //     module has to land before the pack that depends on it.
        // A stable rank over the catalog kind gives both.
        const KIND_RANK: Record<string, number> = {
          license: 0,
          module: 1,
          integration: 1,
          capacity: 2,
          service: 3,
          credit: 4,
        };
        const orderedAddOnLines = [...addOnLines].sort(
          (a, b) =>
            (KIND_RANK[a.meta?.kind ?? ""] ?? 9) -
            (KIND_RANK[b.meta?.kind ?? ""] ?? 9),
        );

        for (const l of orderedAddOnLines) {
          const branchId = l.meta?.branchId;
          // Pass the outer tx so the grant + its outbox emit commit
          // atomically with the hardware order / stock allocation — a later
          // failure rolls the grant back instead of orphaning a paid entitlement.
          if (l.meta?.kind === "credit") {
            // Credits mint a CreditLot, never an ownership row: they are a
            // consumable balance, they do not renew, and they are read live
            // inside the advisory-locked claim rather than from the 30s
            // entitlement cache.
            await this.tenantMarketplace.purchaseCredits(
              tenantId,
              {
                addOnCode: l.code,
                quantity: l.qty,
                paymentRef: paymentRef ?? undefined,
                chargedCents: l.subtotalCents,
              },
              tx,
            );
            continue;
          }
          const ta = await this.tenantMarketplace.purchase(
            tenantId,
            {
              addOnCode: l.code,
              quantity: l.qty,
              branchId,
              paymentRef: paymentRef ?? undefined,
              // Snapshot what was ACTUALLY charged (the prorated slice) and
              // the period it bought, so the provisioned row can never
              // disagree with the money that changed hands.
              chargedCents: l.subtotalCents,
              pricingMeta: {
                annualPriceCents: l.meta?.annualPriceCents,
                prorationMode: l.meta?.prorationMode,
                proratedDays: l.meta?.proratedDays,
                cycleDays: l.meta?.cycleDays,
              },
              periodStart: l.meta?.periodStart
                ? new Date(l.meta.periodStart)
                : undefined,
              periodEnd: l.meta?.periodEnd
                ? new Date(l.meta.periodEnd)
                : undefined,
            },
            tx,
          );
          addOnIds.push(ta.id);
        }

        // 2b. Itemized invoice for the à-la-carte world. Written inside the
        // same transaction as the provisioning so a tenant can never end up
        // with a granted product and no invoice, or vice versa.
        if (paymentRef) {
          await this.tenantInvoices.createFromQuote(tx, {
            tenantId,
            quote,
            paymentRef,
            kind: settledIntent?.renewalCycleId ? "renewal" : "purchase",
            renewalCycleId: settledIntent?.renewalCycleId ?? null,
            referralCode: settledIntent?.referralCode ?? null,
            referredByMarketingUserId:
              settledIntent?.referredByMarketingUserId ?? null,
          });
        }

        // 2c. Marketing-rep commission.
        //
        // This rail has NEVER emitted PaymentSucceeded — only the legacy
        // subscription rail did, and that is the sole input to the marketing
        // service's commission ledger. Moving all money here without this
        // emit would take rep commissions to zero silently, because
        // MarketingEventRelayService PARKS events when the marketing service
        // is unconfigured rather than erroring.
        if (paymentRef && settledIntent?.referredByMarketingUserId) {
          const primary = [...orderedAddOnLines].sort(
            (a, b) => b.subtotalCents - a.subtotalCents,
          )[0];
          const commissionRate = primary
            ? await this.resolveCommissionRate(tx, primary.code)
            : 0.1;
          await tx.outboxEvent.create({
            data: {
              id: uuidv7(),
              type: EventTypes.PaymentSucceeded,
              tenantId,
              payload: {
                tenantId,
                paymentId: paymentRef,
                amount: quote.totalCents / 100,
                currency: quote.currency,
                // A cart containing the licence is the tenant's first paid
                // purchase; anything later is an upsell.
                kind: orderedAddOnLines.some((l) => l.meta?.kind === "license")
                  ? "signup"
                  : "upsell",
                planCode: primary?.code ?? null,
                commissionRate,
                referralCode: settledIntent.referralCode ?? null,
                referredByMarketingUserId:
                  settledIntent.referredByMarketingUserId,
              } as any,
              idempotencyKey: `payment-succeeded:${paymentRef}`,
              status: "queued",
              nextAttemptAt: new Date(),
            },
          });
        }

        // NOTE: checkout no longer touches subscriptions. Plan changes go
        // through the dedicated /subscriptions/change-plan →
        // pendingPlanChange → settlement rail (which prorates and actually
        // applies the new plan). The old "emit subscription.upgrade.requested.v1"
        // step was dead: that event has NO consumer, so the plan never
        // changed even though money was charged for the plan line. QuoteService
        // now REJECTS `type:'plan'` lines, so a plan line can never reach
        // provisioning here in the first place — the emit is gone, not gated.

        // 2d. Close out the renewal this cart paid for, in the same
        // transaction as the provisioning it renewed.
        if (settledIntent?.renewalCycleId) {
          await tx.renewalCycle.updateMany({
            where: {
              id: settledIntent.renewalCycleId,
              tenantId,
              status: "open",
            },
            data: {
              status: "paid",
              paidAt: new Date(),
              paymentRef,
            },
          });
        }

        // Audit event — one row per provisioned cart so ops can answer
        // "where did this provisioning come from".
        await tx.outboxEvent.create({
          data: {
            id: uuidv7(),
            type: "checkout.completed.v1",
            tenantId,
            payload: {
              tenantId,
              paymentRef,
              quote: {
                lines: quote.lines,
                totalCents: quote.totalCents,
                currency: quote.currency,
              },
              hardwareOrderId,
              addOnIds,
            } as any,
            idempotencyKey: uuidv7(),
            status: "queued",
            nextAttemptAt: new Date(),
          },
        });

        // 4. v2.8.86: surface a hardware-specific event when the cart minted
        // a HardwareOrder. CheckoutNotificationsService listens for this
        // and sends the order-placed email; physical-shipment downstreams
        // (fulfilment dashboards, carrier batching) can hook in later
        // without having to filter checkout.completed.v1 by payload shape.
        if (hardwareOrderId) {
          await tx.outboxEvent.create({
            data: {
              id: uuidv7(),
              type: "hardware.order.placed.v1",
              tenantId,
              payload: {
                tenantId,
                hardwareOrderId,
                totalCents: hardwareTotalCents,
                currency: quote.currency,
                paymentRef,
              } as any,
              idempotencyKey: uuidv7(),
              status: "queued",
              nextAttemptAt: new Date(),
            },
          });
        }
      },
      {
        // Serializable so a concurrent settlement (PayTR retry + the authed
        // /confirm endpoint racing the webhook) cannot double-provision. The
        // joined tenantMarketplace.purchase() runs under THIS tx, so without
        // Serializable here it inherited ReadCommitted and the add-on dup-check
        // write-skew that the standalone path's Serializable wrapper guards
        // against re-appeared. A loser aborts with P2034 and PayTR's retry then
        // hits the paymentRef idempotency and returns the committed first result.
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    // Track 2 — record the committed provisioning for Prometheus. After the
    // $transaction commits, optional + ?.-guarded so it can never break the
    // provisioning write. `result` is the developer-controlled paid-vs-comped
    // distinction (paymentRef present → "paid", null → super-admin "comped"),
    // so label cardinality stays bounded. The idempotent-replay early return
    // above never reaches here, so cached hits aren't double-counted.
    this.metrics?.incCounter(
      "checkout_provisions_total",
      "Checkout cart provisions by result (paid|comped)",
      { result: paymentRef ? "paid" : "comped" },
    );

    // Close the loop: provision device-mesh slots for the device-class hardware
    // just purchased, so a bought KDS/printer/terminal/HummyBox shows up in the
    // branch hub ready to pair. POST-commit so it can NEVER roll back the
    // committed (paid) order; idempotent on the order id.
    if (hardwareOrderId) {
      await this.provisionDevicesForOrder(
        tenantId,
        validatedBranchId,
        hardwareOrderId,
        hardwareLines
          .filter((l) => l.type === "hardware")
          .map((l) => ({
            productId: l.meta?.productId as string,
            sku: l.code,
            qty: l.qty,
          })),
      );
    }

    return { quote, hardwareOrderId, addOnIds };
  }

  /**
   * Best-effort hardware→device-mesh provisioning. Looks up each line's
   * category, then asks DeviceService to create one unprovisioned slot per
   * device-class unit so the buyer can pair what they bought from the branch
   * hub. ?.-guarded (DeviceService is @Optional) and fully swallowed: a failure
   * here must NEVER surface to the buyer or roll back the paid order. Safe to
   * call repeatedly — DeviceService.provisionPurchasedDevices is idempotent on
   * hardwareOrderId, which also makes the idempotent-replay path self-healing
   * if the first run crashed after commit but before this hook.
   */
  private async provisionDevicesForOrder(
    tenantId: string,
    branchId: string | null,
    hardwareOrderId: string,
    items: { productId: string; sku: string; qty: number }[],
  ): Promise<void> {
    if (!this.devices) return;
    try {
      const productIds = items.map((i) => i.productId).filter(Boolean);
      if (productIds.length === 0) return;
      const cats = await this.prisma.hardwareProduct.findMany({
        where: { id: { in: productIds } },
        select: { id: true, category: true },
      });
      const catById = new Map(cats.map((c) => [c.id, c.category]));
      await this.devices.provisionPurchasedDevices(
        tenantId,
        branchId,
        hardwareOrderId,
        items.map((i) => ({
          productId: i.productId,
          sku: i.sku,
          qty: i.qty,
          category: catById.get(i.productId) ?? "",
        })),
      );
    } catch (e) {
      this.logger.warn(
        `hardware→device provisioning failed for order ${hardwareOrderId}: ${(e as Error)?.message}`,
      );
    }
  }
}
