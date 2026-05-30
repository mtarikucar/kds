import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService } from '../catalog/catalog.service';
import { AddOnCatalogService } from '../marketplace/addon-catalog.service';
import { Cart, CartQuote, PricedLine } from './checkout.types';

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
const TR_KDV_RATE = 0.20;
// Legacy hardcoded service codes — kept ONLY as a fallback for spec
// stability. Production service catalog lives in HardwareProduct
// (category: 'service') since v2.8.87. Adding a new service means
// upserting a HardwareProduct row, not extending this map.
const LEGACY_SERVICE_PRICES_CENTS: Record<string, { name: string; priceCents: number }> = {
  onsite_install_kds: { name: 'On-site KDS installation', priceCents: 250000 },
  training_4h: { name: '4-hour staff training', priceCents: 150000 },
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
      throw new BadRequestException('Cart is empty');
    }

    const lines: PricedLine[] = [];
    const warnings: string[] = [];
    let currency = 'TRY';

    for (const item of cart.items) {
      const qty = Math.max(1, ('qty' in item && item.qty ? item.qty : 1));
      if (item.type === 'plan') {
        const plan = await this.prisma.subscriptionPlan.findUnique({ where: { name: item.code } });
        if (!plan) {
          warnings.push(`Unknown plan: ${item.code}`);
          continue;
        }
        currency = plan.currency;
        const cycle = item.billingCycle ?? 'MONTHLY';
        const priceDec = cycle === 'YEARLY' ? plan.yearlyPrice : plan.monthlyPrice;
        const unitCents = Math.round(Number(priceDec) * 100);
        lines.push({
          type: 'plan',
          code: plan.name,
          name: plan.displayName,
          qty: 1,
          unitCents,
          subtotalCents: unitCents,
          cadence: cycle === 'YEARLY' ? 'yearly' : 'monthly',
          meta: { planId: plan.id, billingCycle: cycle },
        });
      } else if (item.type === 'addon') {
        const addOn = await this.addons.findByCodeOrThrow(item.code);
        if (addOn.status !== 'published') {
          warnings.push(`Add-on not purchasable: ${addOn.code}`);
          continue;
        }
        currency = addOn.currency;
        lines.push({
          type: 'addon',
          code: addOn.code,
          name: addOn.name,
          qty,
          unitCents: addOn.priceCents,
          subtotalCents: addOn.priceCents * qty,
          cadence: addOn.billing === 'recurring' ? 'monthly' : 'oneTime',
          meta: { addOnId: addOn.id, kind: addOn.kind, branchId: 'branchId' in item ? item.branchId : undefined },
        });
      } else if (item.type === 'hardware') {
        const product = await this.catalog.findBySkuOrThrow(item.sku);
        if (product.status !== 'published') {
          warnings.push(`Hardware not purchasable: ${product.sku}`);
          continue;
        }
        currency = product.currency;
        const acquisition = item.acquisition ?? 'sell';
        if (acquisition === 'rent' && !product.rentalMonthlyCents) {
          throw new BadRequestException(`SKU ${product.sku} is not available for rental`);
        }
        const unitCents = acquisition === 'rent' ? product.rentalMonthlyCents! : product.priceCents;
        lines.push({
          type: 'hardware',
          code: product.sku,
          name: product.name,
          qty,
          unitCents,
          subtotalCents: unitCents * qty,
          cadence: acquisition === 'rent' ? 'monthly' : 'oneTime',
          meta: { productId: product.id, acquisition, warrantyMonths: product.warrantyMonths },
        });
      } else if (item.type === 'service') {
        // v2.8.87: services live in HardwareProduct (category: 'service').
        // The cart-line `code` IS the SKU. Look up the catalog row first;
        // fall back to the 2 legacy in-memory codes only if the row isn't
        // present (keeps spec stability for fixtures that don't seed the
        // service catalog).
        let resolved: { name: string; priceCents: number; currency: string; serviceMeta?: any } | null = null;
        try {
          const product = await this.catalog.findBySkuOrThrow(item.code);
          if (product.category !== 'service' || product.status !== 'published') {
            warnings.push(`Not purchasable as service: ${item.code}`);
            continue;
          }
          resolved = {
            name: product.name,
            priceCents: product.priceCents,
            currency: product.currency,
            serviceMeta: product.serviceMeta,
          };
        } catch {
          const legacy = LEGACY_SERVICE_PRICES_CENTS[item.code];
          if (legacy) {
            resolved = {
              name: legacy.name,
              priceCents: legacy.priceCents,
              currency: 'TRY',
              serviceMeta: undefined,
            };
          }
        }
        if (!resolved) {
          warnings.push(`Unknown service: ${item.code}`);
          continue;
        }
        currency = resolved.currency;
        lines.push({
          type: 'service',
          code: item.code,
          name: resolved.name,
          qty,
          unitCents: resolved.priceCents,
          subtotalCents: resolved.priceCents * qty,
          cadence: 'oneTime',
          meta: {
            branchId: item.branchId,
            // Forward service-order context from the cart line so
            // CheckoutService can read serviceType (for install-trigger)
            // and preferredDates/notes (for InstallationRequest) without
            // re-fetching the product row.
            serviceMeta: resolved.serviceMeta,
            preferredDates: item.preferredDates,
            notes: item.notes,
          },
        });
      }
    }

    const subtotalCents = lines.reduce((acc, l) => acc + l.subtotalCents, 0);
    // Flat KDV for TR. Once the accounting service exposes a "tax for cart"
    // helper the line item-level KDV rate (food vs. service vs. goods) plugs
    // in here.
    const taxRate = currency === 'TRY' ? TR_KDV_RATE : 0;
    const taxCents = Math.round(subtotalCents * taxRate);
    // Shipping placeholder — Phase 10 swaps this for a carrier quote.
    const hasHardware = lines.some((l) => l.type === 'hardware');
    const shippingCents = hasHardware ? 5000 : 0;

    return {
      lines,
      currency,
      subtotalCents,
      taxCents,
      shippingCents,
      totalCents: subtotalCents + taxCents + shippingCents,
      warnings,
      isPureRecurring: lines.every((l) => l.type === 'plan' || l.type === 'addon'),
    };
  }
}
