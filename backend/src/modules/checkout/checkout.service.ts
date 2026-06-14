import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import { PrismaService } from "../../prisma/prisma.service";
import { MetricsService } from "../../common/metrics/metrics.service";
import { OutboxService } from "../outbox/outbox.service";
import { CatalogService } from "../catalog/catalog.service";
import { TenantMarketplaceService } from "../marketplace/tenant-marketplace.service";
import { Cart, CartQuote, PricedLine } from "./checkout.types";
import { QuoteService } from "./quote.service";

/**
 * Checkout orchestrator — turns a Cart into:
 *   - one HardwareOrder (if cart has hardware/service)
 *   - one or more TenantAddOn provisions (if cart has add-ons)
 *   - a subscription change command (if cart has a plan; lands as
 *     subscription.upgrade.requested for the existing SubscriptionService to
 *     pick up)
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
    // Optional so unit tests constructing the service bare keep working.
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /** Re-price the cart at confirm time so the user can't tamper with totals. */
  async confirmAndProvision(
    tenantId: string,
    cart: Cart,
    paymentRef: string | null,
  ): Promise<{
    quote: CartQuote;
    hardwareOrderId?: string;
    addOnIds: string[];
  }> {
    const quote = await this.quoteSvc.quote(cart);

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
    const planLines = quote.lines.filter((l) => l.type === "plan");

    // v2.8.99.3 — tenant-scoped active-branch validation. The buyer
    // picked a branch in the shipping form; we trust the SPA to copy
    // the branch's address into cart.shippingAddress (snapshot) but
    // re-validate the branchId here so a forged or stale request
    // can't stamp another tenant's branch onto this HardwareOrder.
    // Archived branches are rejected too — re-activating an archived
    // branch is a deliberate operator action, not something a
    // checkout flow should resurrect by proxy.
    let validatedBranchId: string | null = null;
    if (cart.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: cart.branchId, tenantId, status: "active" },
        select: { id: true },
      });
      if (!branch) {
        throw new BadRequestException(
          `branchId ${cart.branchId} is not an active branch for this tenant`,
        );
      }
      validatedBranchId = branch.id;
    }

    let hardwareOrderId: string | undefined;
    const addOnIds: string[] = [];

    await this.prisma.$transaction(async (tx) => {
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
            subtotalCents: hardwareLines.reduce(
              (a, l) => a + l.subtotalCents,
              0,
            ),
            taxCents: Math.round(
              hardwareLines.reduce((a, l) => a + l.subtotalCents, 0) *
                (quote.taxCents / Math.max(1, quote.subtotalCents)),
            ),
            shippingCents: quote.shippingCents,
            totalCents:
              hardwareLines.reduce((a, l) => a + l.subtotalCents, 0) +
              quote.shippingCents,
            currency: quote.currency,
            shippingAddress: cart.shippingAddress as any,
            billingAddress: cart.billingAddress as any,
            installation: onsiteServiceLines.length > 0 ? "requested" : null,
            paymentRef,
          },
        });
        hardwareOrderId = order.id;

        for (const l of hardwareLines.filter((l) => l.type === "hardware")) {
          const productId = l.meta?.productId as string;
          const acquisition = l.meta?.acquisition ?? "sell";
          // Allocate stock inside the same tx so over-selling is impossible.
          const { serials } = await this.catalog.allocate(productId, l.qty, tx);
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
                meta.notes ?? `Auto-created from checkout (service: ${l.code})`,
            },
          });
        }
      }

      // 2. Add-ons. Each line is one TenantAddOn row at the requested qty.
      // Already-deduped by the catalog service; dependency checks run inside
      // tenantMarketplace.purchase.
      for (const l of addOnLines) {
        const branchId = l.meta?.branchId;
        const ta = await this.tenantMarketplace.purchase(tenantId, {
          addOnCode: l.code,
          quantity: l.qty,
          branchId,
          paymentRef: paymentRef ?? undefined,
        });
        addOnIds.push(ta.id);
      }

      // 3. Plan upgrades emit a request event for SubscriptionService to
      // handle (it has the proration / per-plan trial logic). The checkout
      // flow does NOT mutate Subscriptions directly to keep ownership clean.
      for (const l of planLines) {
        await tx.outboxEvent.create({
          data: {
            id: uuidv7(),
            type: "subscription.upgrade.requested.v1",
            tenantId,
            payload: {
              tenantId,
              planCode: l.code,
              billingCycle: l.meta?.billingCycle ?? "MONTHLY",
              paymentRef,
            } as any,
            idempotencyKey: uuidv7(),
            status: "queued",
            nextAttemptAt: new Date(),
          },
        });
      }

      // 4. Audit event — one row per provisioned cart so ops can answer
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

      // 5. v2.8.86: surface a hardware-specific event when the cart minted
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
              totalCents:
                hardwareLines.reduce((a, l) => a + l.subtotalCents, 0) +
                quote.shippingCents,
              currency: quote.currency,
              paymentRef,
            } as any,
            idempotencyKey: uuidv7(),
            status: "queued",
            nextAttemptAt: new Date(),
          },
        });
      }
    });

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

    return { quote, hardwareOrderId, addOnIds };
  }
}
