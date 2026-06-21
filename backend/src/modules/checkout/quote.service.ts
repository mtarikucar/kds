import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { resolvePlanAmount } from "../subscriptions/plan-pricing.helper";
import { CatalogService } from "../catalog/catalog.service";
import { AddOnCatalogService } from "../marketplace/addon-catalog.service";
import { Cart, CartQuote, PricedLine } from "./checkout.types";

/**
 * Pure-ish pricing engine. Given a Cart, returns line-by-line pricing plus a
 * total. NO database writes — quote is the gateway to checkout, where the
 * actual orders land in a single transaction.
 *
 * Tax is simplified: a single VAT rate per tenant currency (TR KDV defaults
 * to 20%). Real-world calculation will plug into the existing `accounting`
 * service in Phase 6+ once payment abstraction lets us share the same code
 * path between subscription and hardware invoices.
 *
 * Shipping is computed on the heaviest hardware-shipping profile in the cart;
 * if none, shipping is free. This deliberately under-models the carrier
 * matrix for MVP — the real number comes in once Phase 10 carrier adapters
 * land.
 */
const TR_KDV_RATE = 0.2;
// Legacy hardcoded service codes — kept ONLY as a fallback for spec
// stability. Production service catalog lives in HardwareProduct
// (category: 'service') since v2.8.87. Adding a new service means
// upserting a HardwareProduct row, not extending this map.
const LEGACY_SERVICE_PRICES_CENTS: Record<
  string,
  { name: string; priceCents: number }
> = {
  onsite_install_kds: { name: "On-site KDS installation", priceCents: 250000 },
  training_4h: { name: "4-hour staff training", priceCents: 150000 },
};

@Injectable()
export class QuoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly addons: AddOnCatalogService,
  ) {}

  async quote(cart: Cart): Promise<CartQuote> {
    if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
      throw new BadRequestException("Cart is empty");
    }

    const lines: PricedLine[] = [];
    const warnings: string[] = [];
    let currency = "TRY";

    for (const item of cart.items) {
      const qty = Math.max(1, "qty" in item && item.qty ? item.qty : 1);
      if (item.type === "plan") {
        const plan = await this.prisma.subscriptionPlan.findUnique({
          where: { name: item.code },
        });
        if (!plan) {
          warnings.push(`Unknown plan: ${item.code}`);
          continue;
        }
        currency = plan.currency;
        const cycle = item.billingCycle ?? "MONTHLY";
        // Honor an active promotional discount — the advertised price.
        const priceDec = resolvePlanAmount(plan, cycle);
        const unitCents = Math.round(Number(priceDec) * 100);
        lines.push({
          type: "plan",
          code: plan.name,
          name: plan.displayName,
          qty: 1,
          unitCents,
          subtotalCents: unitCents,
          cadence: cycle === "YEARLY" ? "yearly" : "monthly",
          meta: { planId: plan.id, billingCycle: cycle },
        });
      } else if (item.type === "addon") {
        const addOn = await this.addons.findByCodeOrThrow(item.code);
        if (addOn.status !== "published") {
          warnings.push(`Add-on not purchasable: ${addOn.code}`);
          continue;
        }
        currency = addOn.currency;
        lines.push({
          type: "addon",
          code: addOn.code,
          name: addOn.name,
          qty,
          unitCents: addOn.priceCents,
          subtotalCents: addOn.priceCents * qty,
          cadence: addOn.billing === "recurring" ? "monthly" : "oneTime",
          meta: {
            addOnId: addOn.id,
            kind: addOn.kind,
            branchId: "branchId" in item ? item.branchId : undefined,
          },
        });
      } else if (item.type === "hardware") {
        const product = await this.catalog.findBySkuOrThrow(item.sku);
        if (product.status !== "published") {
          warnings.push(`Hardware not purchasable: ${product.sku}`);
          continue;
        }
        // Regulatory tier guard (TR law) — the authoritative gate. Only
        // DIRECT_SALE products may be priced/paid. QUOTE_ONLY (yazarkasa /
        // YN ÖKC), PARTNER_REDIRECT (bank POS) and RECOMMENDED_ONLY
        // (uncertified scale) are dropped from the quote even if a tampered
        // client managed to add them — they never reach intent/payment/
        // provision. Mirrors the existing unpublished-product behavior above.
        //
        // v3.0.1 round-4 audit fix — fail-closed: explicit `!== "DIRECT_SALE"`
        // without the truthiness short-circuit. Pre-fix `product.saleMode &&
        // product.saleMode !== "DIRECT_SALE"` let a null/empty saleMode fall
        // through as buyable. The schema defaults the column to "DIRECT_SALE"
        // and the seed sets it on every row, but a manually-inserted row,
        // a partial backfill, or a future DB shape change could silently
        // re-open the gap. Treat absent as not-direct = NOT buyable.
        if (product.saleMode !== "DIRECT_SALE") {
          warnings.push(`Hardware not directly purchasable: ${product.sku}`);
          continue;
        }
        currency = product.currency;
        const acquisition = item.acquisition ?? "sell";
        if (acquisition === "rent" && !product.rentalMonthlyCents) {
          throw new BadRequestException(
            `SKU ${product.sku} is not available for rental`,
          );
        }
        const unitCents =
          acquisition === "rent"
            ? product.rentalMonthlyCents!
            : product.priceCents;
        lines.push({
          type: "hardware",
          code: product.sku,
          name: product.name,
          qty,
          unitCents,
          subtotalCents: unitCents * qty,
          cadence: acquisition === "rent" ? "monthly" : "oneTime",
          meta: {
            productId: product.id,
            acquisition,
            warrantyMonths: product.warrantyMonths,
          },
        });
      } else if (item.type === "service") {
        // v2.8.87: services live in HardwareProduct (category: 'service').
        // The cart-line `code` IS the SKU. Look up the catalog row first;
        // fall back to the 2 legacy in-memory codes only if the row isn't
        // present (keeps spec stability for fixtures that don't seed the
        // service catalog).
        let resolved: {
          name: string;
          priceCents: number;
          currency: string;
          serviceMeta?: any;
          // v3.0.1 round-4 — surface the regulatory tier on the priced
          // line. The post-quote consumer (CheckoutService.confirm,
          // InstallationRequest.create) wants to see why a service was
          // priced and the analytics layer separates DIRECT_SALE installs
          // from legacy (no-saleMode) ones.
          saleMode?: string;
        } | null = null;
        try {
          const product = await this.catalog.findBySkuOrThrow(item.code);
          if (
            product.category !== "service" ||
            product.status !== "published"
          ) {
            warnings.push(`Not purchasable as service: ${item.code}`);
            continue;
          }
          // Regulatory tier guard (TR law) — same fail-closed gate as the
          // hardware branch. A service row (e.g. a fiscal yazarkasa-install /
          // GİB-activation offering) can carry any saleMode, so a non-
          // DIRECT_SALE service must be dropped here too — otherwise it would
          // be priced/paid/provisioned (incl. an InstallationRequest),
          // bypassing the QUOTE_ONLY control. Legacy in-memory service codes
          // (catch block below) have no row and stay DIRECT_SALE.
          if (product.saleMode !== "DIRECT_SALE") {
            warnings.push(`Service not directly purchasable: ${item.code}`);
            continue;
          }
          resolved = {
            name: product.name,
            priceCents: product.priceCents,
            currency: product.currency,
            serviceMeta: product.serviceMeta,
            // Forward the resolved tier onto the line so the post-quote
            // audit trail (and the CheckoutService's intent-create step)
            // can see why this service was priced — the regulatory gate
            // already passed but the original tier value is useful for
            // analytics and the dealer-quote sub-flow.
            saleMode: product.saleMode,
          };
        } catch {
          const legacy = LEGACY_SERVICE_PRICES_CENTS[item.code];
          if (legacy) {
            resolved = {
              name: legacy.name,
              priceCents: legacy.priceCents,
              currency: "TRY",
              serviceMeta: undefined,
              // Legacy hardcoded codes are direct-sale by construction;
              // they predate the saleMode column.
              saleMode: "DIRECT_SALE",
            };
          }
        }
        if (!resolved) {
          warnings.push(`Unknown service: ${item.code}`);
          continue;
        }
        currency = resolved.currency;
        lines.push({
          type: "service",
          code: item.code,
          name: resolved.name,
          qty,
          unitCents: resolved.priceCents,
          subtotalCents: resolved.priceCents * qty,
          cadence: "oneTime",
          meta: {
            branchId: item.branchId,
            // Forward service-order context from the cart line so
            // CheckoutService can read serviceType (for install-trigger)
            // and preferredDates/notes (for InstallationRequest) without
            // re-fetching the product row.
            serviceMeta: resolved.serviceMeta,
            saleMode: resolved.saleMode,
            preferredDates: item.preferredDates,
            notes: item.notes,
          },
        });
      }
    }

    // Line prices are KDV-INCLUSIVE (gross) — see billing/kdv.helper. The tax is
    // already INSIDE the line prices, so derive it OUT for the invoice
    // breakdown; never add it on top. Adding 20% on top here 20%-overcharged
    // every checkout/PayTR purchase versus the displayed price AND versus the
    // havale rail (which charges the stored price as gross).
    const grossLines = lines.reduce((acc, l) => acc + l.subtotalCents, 0);
    const taxRate = currency === "TRY" ? TR_KDV_RATE : 0;
    const netCents =
      taxRate > 0 ? Math.round(grossLines / (1 + taxRate)) : grossLines;
    const taxCents = grossLines - netCents; // KDV embedded in the gross lines
    // Shipping placeholder — Phase 10 swaps this for a carrier quote.
    const hasHardware = lines.some((l) => l.type === "hardware");
    const shippingCents = hasHardware ? 5000 : 0;

    return {
      lines,
      currency,
      // subtotal is NET so the invoice adds up: net + tax + shipping == gross +
      // shipping == the amount actually charged. Line prices stay gross.
      subtotalCents: netCents,
      taxCents,
      shippingCents,
      totalCents: grossLines + shippingCents,
      warnings,
      isPureRecurring: lines.every(
        (l) => l.type === "plan" || l.type === "addon",
      ),
    };
  }
}
