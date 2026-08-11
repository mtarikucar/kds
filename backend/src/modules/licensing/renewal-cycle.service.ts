import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { QuoteService } from "../checkout/quote.service";
import { Cart } from "../checkout/checkout.types";
import { ADDON_GRACE_DAYS } from "../marketplace/marketplace.types";
import { LicensingService } from "./licensing.service";
import { anchorDateFor, nextAnniversary } from "./anniversary";

/** How far ahead of the anniversary a renewal is materialized. */
export const RENEWAL_LEAD_DAYS = 30;

/** Days before the anniversary a reminder is sent. */
export const REMINDER_DAYS = [30, 7, 1] as const;

/**
 * The tenant's annual renewal, materialized ahead of time.
 *
 * Everything a tenant owns shares one anniversary, so a renewal is ONE cart
 * with one line per owned product. Freezing it ~30 days ahead is what gives
 * the reminder cron a stable target, the invoice something to itemize, and
 * the grace/expiry job a record of what was actually owed.
 *
 * Prices are read LIVE from the catalog at generation time — the catalog is
 * superadmin-editable, which is the point — and then frozen. A tenant pays
 * exactly what the reminder email quoted them, even if an operator re-prices
 * the catalog the next day.
 */
@Injectable()
export class RenewalCycleService {
  private readonly logger = new Logger(RenewalCycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly licensing: LicensingService,
    private readonly quotes: QuoteService,
  ) {}

  /**
   * Build (and persist) the renewal for a tenant's next anniversary.
   *
   * Idempotent on `(tenantId, anniversaryAt)`: the generator cron can run on
   * every replica and only one cycle exists per year.
   */
  async generate(tenantId: string, now = new Date()) {
    const ctx = await this.licensing.loadContext(tenantId, now);
    if (!ctx.anchorAt) return null; // never licensed — nothing renews

    const anniversaryAt = nextAnniversary(
      ctx.anchorAt,
      anchorDateFor(now, ctx.tz),
    );

    const existing = await this.prisma.renewalCycle.findUnique({
      where: { tenantId_anniversaryAt: { tenantId, anniversaryAt } },
    });
    if (existing) return existing;

    const items = await this.renewableItems(tenantId);
    if (items.length === 0) return null;

    // A renewal covers a WHOLE cycle, so it is priced at full list. Quoting
    // AS OF the anniversary is what produces that: on the anniversary itself
    // remainingDays equals cycleDays, so proration returns the full price
    // rather than a stub — no special "skip proration" flag needed.
    const cart: Cart = {
      // renewalCycleId travels with the cart so the purchasability guard
      // knows these lines are re-buys, and settlement knows which cycle it
      // is closing out.
      renewalCycleId: undefined,
      items: items.map((i) => ({
        type: "addon" as const,
        code: i.code,
        qty: i.quantity,
        branchId: i.branchId ?? undefined,
      })),
    };
    const quote = await this.quotes.quote(cart, tenantId, {
      now: anniversaryAt,
    });

    return this.prisma.renewalCycle.create({
      data: {
        tenantId,
        anniversaryAt,
        status: "open",
        cartJson: cart as any,
        quoteJson: quote as any,
        totalCents: quote.totalCents,
        currency: quote.currency,
        graceEndsAt: new Date(
          anniversaryAt.getTime() + ADDON_GRACE_DAYS * 86_400_000,
        ),
      },
    });
  }

  /**
   * What the tenant will be billed for.
   *
   * `pendingQuantity` is honoured here — a capacity downgrade requested
   * mid-year takes effect at renewal, which is the only place it can without
   * refunding a period the tenant already paid for.
   */
  private async renewableItems(tenantId: string) {
    const rows = await this.prisma.tenantAddOn.findMany({
      where: {
        tenantId,
        status: { in: ["active", "past_due"] },
        cancelAtPeriodEnd: false,
        // One-time products (credits, services) do not renew.
        addOn: { billing: "annual" },
      },
      include: { addOn: { select: { code: true } } },
    });
    return rows
      .map((r) => ({
        code: r.addOn.code,
        quantity: r.pendingQuantity ?? r.quantity,
        branchId: r.branchId,
      }))
      .filter((r) => r.quantity > 0);
  }

  /** The open cycle a tenant should be paying, if any. */
  async openFor(tenantId: string) {
    return this.prisma.renewalCycle.findFirst({
      where: { tenantId, status: "open" },
      orderBy: { anniversaryAt: "asc" },
    });
  }

  async findForTenant(tenantId: string, cycleId: string) {
    const cycle = await this.prisma.renewalCycle.findFirst({
      where: { id: cycleId, tenantId },
    });
    if (!cycle) throw new NotFoundException("Renewal not found");
    return cycle;
  }

  /**
   * Record a reminder as sent, atomically.
   *
   * The array append happens inside the same UPDATE that filters on the day
   * not already being present, so two replicas firing the cron in the same
   * minute cannot both send. Without that, a tenant gets the same reminder
   * twice — which reads as a billing system that has lost track.
   */
  async markReminderSent(cycleId: string, day: number): Promise<boolean> {
    const res = await this.prisma.$executeRaw`
      UPDATE "renewal_cycles"
         SET "remindersSent" = array_append("remindersSent", ${day}::int)
       WHERE "id" = ${cycleId}
         AND NOT (${day}::int = ANY("remindersSent"))`;
    return res > 0;
  }

  async markPaid(
    tx: Prisma.TransactionClient,
    cycleId: string,
    paymentRef: string,
    invoiceId?: string,
  ) {
    await tx.renewalCycle.updateMany({
      where: { id: cycleId, status: "open" },
      data: {
        status: "paid",
        paidAt: new Date(),
        paymentRef,
        invoiceId: invoiceId ?? null,
      },
    });
  }
}
