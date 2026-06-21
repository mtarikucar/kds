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
 * Dependency check rule: every entry in `deps` must currently apply to the
 * tenant. Plan deps (`plan:PRO`) match Tenant.currentPlan.name. Add-on deps
 * match the codes of currently-active TenantAddOn rows for the tenant.
 */
@Injectable()
export class TenantMarketplaceService {
  private readonly logger = new Logger(TenantMarketplaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: AddOnCatalogService,
    private readonly outbox: OutboxService,
  ) {}

  async purchase(
    tenantId: string,
    input: {
      addOnCode: string;
      quantity?: number;
      branchId?: string;
      paymentRef?: string;
    },
    // When supplied (checkout/PayTR settlement), the grant joins the caller's
    // transaction so it rolls back atomically with the rest of the cart instead
    // of committing on a separate connection.
    callerTx?: Prisma.TransactionClient,
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
    if (addOn.priceCents > 0 && !input.paymentRef) {
      throw new ForbiddenException(
        `Add-on "${addOn.code}" requires payment; purchase it through checkout.`,
      );
    }

    // Verify deps are satisfied for this specific tenant. Catalog-level
    // resolveDeps only confirms the dep references exist; this is the
    // tenant-specific apply-time check.
    if (addOn.deps.length > 0) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        include: { currentPlan: { select: { name: true } } },
      });
      if (!tenant) throw new NotFoundException("Tenant not found");

      const planName = tenant.currentPlan?.name ?? null;
      const activeAddOns = await this.prisma.tenantAddOn.findMany({
        where: { tenantId, status: "active" },
        include: { addOn: { select: { code: true } } },
      });
      const haveAddOnCodes = new Set(activeAddOns.map((ta) => ta.addOn.code));

      const missing: string[] = [];
      for (const dep of addOn.deps) {
        if (dep.startsWith("plan:")) {
          if (`plan:${planName ?? ""}` !== dep) missing.push(dep);
        } else if (!haveAddOnCodes.has(dep)) {
          missing.push(dep);
        }
      }
      if (missing.length > 0) {
        throw new BadRequestException(
          `Add-on requires: ${missing.join(", ")}. Upgrade your plan or purchase the required add-ons first.`,
        );
      }
    }

    const qty = input.quantity ?? 1;
    const now = new Date();

    // Recurring add-ons project a 30-day window so the cancellation flow has
    // a meaningful `currentPeriodEnd`. Real billing cycles are aligned to
    // the parent Subscription cycle once Phase 5 checkout wires them up.
    const currentPeriodEnd =
      addOn.billing === "oneTime"
        ? null
        : new Date(now.getTime() + 30 * 24 * 3600 * 1000);

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
        throw new BadRequestException(
          `Add-on "${addOn.code}" is already active for this ${input.branchId ? "branch" : "tenant"}. Cancel the existing subscription or change quantity instead.`,
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
          currentPeriodStart: now,
          currentPeriodEnd,
          paymentRef: input.paymentRef ?? null,
        },
      });

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

  async cancel(tenantId: string, tenantAddOnId: string, immediate = false) {
    const row = await this.prisma.tenantAddOn.findFirst({
      where: { id: tenantAddOnId, tenantId },
    });
    if (!row) throw new NotFoundException("Add-on not found for this tenant");
    if (row.status !== "active")
      throw new BadRequestException(`Cannot cancel — status is ${row.status}`);

    const now = new Date();
    // v2.8.96 — fold claim + post-fetch + emit into one transaction.
    // Pre-fix the emit ran AFTER the updateMany commit; a process
    // crash between commit and emit left the add-on cancelled with no
    // projector signal, so the granted limits/features stayed live
    // until the next reconcile cron caught it.
    //
    // Compound WHERE (B41-B45 pattern, iter-31 onward) + status='active'
    // gate so two concurrent cancel calls converge on a single
    // transition. The previous shape (.update by id) accepted the
    // second writer too and would double-emit the AddOnCancelled
    // outbox event; the count check below makes the loser explicit.
    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.tenantAddOn.updateMany({
        where: { id: tenantAddOnId, tenantId, status: "active" },
        data: immediate
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
      if (immediate) {
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
