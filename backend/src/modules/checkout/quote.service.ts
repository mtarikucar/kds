import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CatalogService } from "../catalog/catalog.service";
import { AddOnCatalogService } from "../marketplace/addon-catalog.service";
import { LicensingService } from "../licensing/licensing.service";
import { Cart, CartQuote, PricedLine, QuoteWarning } from "./checkout.types";

/**
 * Pure-ish pricing engine. Given a Cart, returns line-by-line pricing plus a
 * total. NO database writes — quote is the gateway to checkout, where the
 * actual orders land in a single transaction.
 *
 * v3.3.0 — annual lines are DAY-PRORATED to the tenant's licence anniversary,
 * which makes pricing tenant-scoped (hence the `tenantId` parameter) and
 * time-dependent (hence `opts.now`).
 *
 * `opts.now` is not a convenience for tests. CheckoutService re-quotes the
 * cart at settlement and refuses to provision when the total diverges by more
 * than one kuruş. Proration depends on "how many days are left", so an intent
 * created at 23:58 and settled at 00:03 would re-quote a day cheaper: the card
 * is charged and nothing is provisioned. Settlement therefore passes
 * `CheckoutIntent.pricedAt` back in, and the tolerance keeps doing its real
 * job — catching catalog price edits between intent and settlement.
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
    private readonly licensing: LicensingService,
  ) {}

  async quote(
    cart: Cart,
    tenantId: string,
    opts: { now?: Date } = {},
  ): Promise<CartQuote> {
    if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
      throw new BadRequestException("Cart is empty");
    }

    const lines: PricedLine[] = [];
    const warnings: QuoteWarning[] = [];
    let currency = "TRY";

    // FROZEN pricing instant. Settlement passes CheckoutIntent.pricedAt back
    // in so the re-quote is deterministic; see the class doc.
    const now = opts.now ?? new Date();
    // Loaded once for the whole cart — the opening cart contains the licence
    // that DEFINES the anniversary, so every line must be priced against one
    // resolved anchor.
    const licensing = await this.licensing.loadContext(tenantId, now);

    for (const item of cart.items) {
      const qty = Math.max(1, "qty" in item && item.qty ? item.qty : 1);
      if (item.type === "addon") {
        const addOn = await this.addons.findByCodeOrThrow(item.code);
        if (addOn.status !== "published") {
          warnings.push({ code: "addon_not_purchasable", ref: addOn.code });
          continue;
        }
        currency = addOn.currency;

        if (addOn.billing === "annual") {
          // Day-prorated to the tenant's anniversary so the whole account
          // renews on ONE date with ONE itemized invoice.
          const p = this.licensing.price(licensing, addOn.priceCents, {
            quantity: qty,
          });
          lines.push({
            type: "addon",
            code: addOn.code,
            name: addOn.name,
            qty,
            unitCents: p.unitCents,
            subtotalCents: p.subtotalCents,
            cadence: "yearly",
            meta: {
              addOnId: addOn.id,
              kind: addOn.kind,
              branchId: "branchId" in item ? item.branchId : undefined,
              annualPriceCents: addOn.priceCents,
              prorationMode: p.mode,
              proratedDays: p.billedDays,
              cycleDays: p.cycleDays,
              periodStart: p.periodStart.toISOString(),
              periodEnd: p.periodEnd.toISOString(),
              requiresLicense: addOn.requiresLicense,
            },
          });
        } else if (addOn.billing !== "oneTime") {
          // Fail-closed on anything that is neither annual nor oneTime.
          //
          // This branch used to be a bare `else`, which meant a row carrying a
          // legacy cadence — the pre-à-la-carte catalog wrote billing='MONTHLY'
          // — was priced as a flat one-time charge with no period at all. A
          // ₺49,99/month product became ₺49,99 once, granting its feature
          // permanently, while the annual product covering the same feature
          // cost ₺990/year. Only `oneTime` may be sold as a flat price; a
          // cadence the pricer does not understand is not purchasable.
          warnings.push({ code: "addon_not_purchasable", ref: addOn.code });
          continue;
        } else {
          // oneTime — credit packs and services. Flat price, no period.
          lines.push({
            type: "addon",
            code: addOn.code,
            name: addOn.name,
            qty,
            unitCents: addOn.priceCents,
            subtotalCents: addOn.priceCents * qty,
            cadence: "oneTime",
            meta: {
              addOnId: addOn.id,
              kind: addOn.kind,
              branchId: "branchId" in item ? item.branchId : undefined,
              requiresLicense: addOn.requiresLicense,
              ...(addOn.creditKind
                ? {
                    creditKind: addOn.creditKind,
                    creditUnits: (addOn.creditUnits ?? 0) * qty,
                  }
                : {}),
            },
          });
        }
      } else if (item.type === "hardware") {
        const product = await this.catalog.findBySkuOrThrow(item.sku);
        if (product.status !== "published") {
          warnings.push({ code: "hardware_not_purchasable", ref: product.sku });
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
          warnings.push({
            code: "hardware_not_directly_purchasable",
            ref: product.sku,
          });
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
        // Task 4 — soft, display-only warning when the requested qty
        // exceeds real inventory. Deliberately does NOT drop the line
        // (the buyer should still see the price/total) and is NOT the
        // enforcement gate — CheckoutIntentService.createIntent is what
        // actually blocks payment (HARDWARE_OUT_OF_STOCK). Checked for
        // both 'sell' and 'rent': confirmAndProvision calls
        // CatalogService.allocate() for every hardware line regardless of
        // acquisition (a rented unit still comes out of the same physical
        // stock pool), so rentals are stock-gated too.
        const stock = await this.catalog.getAvailableStock(product.id);
        if (stock < qty) {
          warnings.push({ code: "hardware_out_of_stock", ref: product.sku });
        }
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
            warnings.push({ code: "service_not_purchasable", ref: item.code });
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
            warnings.push({
              code: "service_not_directly_purchasable",
              ref: item.code,
            });
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
          warnings.push({ code: "unknown_service", ref: item.code });
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
      isPureRecurring: lines.every((l) => l.type === "addon"),
    };
  }
}
