import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';

/** Prefixed entitlement keys, exactly as the engine folds them. */
export interface EntitlementSet {
  features: Record<string, boolean>;
  limits: Record<string, number>;
  integrations: Record<string, string[]>;
  computedAt: string;
}

export type LicenseStatus = 'none' | 'active' | 'grace' | 'expired';

export interface LicenseState {
  status: LicenseStatus;
  /** The immutable anniversary anchor, or null before the first licence. */
  anchorAt: string | null;
  anniversaryAt: string | null;
  daysRemaining: number | null;
}

export interface OwnedProduct {
  code: string;
  name: string;
  kind: string;
  quantity: number;
  pendingQuantity: number | null;
  status: string;
  periodEnd: string | null;
  /** What was actually charged — the prorated slice, not the list price. */
  chargedCents: number | null;
  /** What this line costs at renewal: full list × quantity. */
  renewalCents: number;
  currency: string;
  origin: string;
}

export interface Offer {
  code: string;
  name: string;
  kind: string;
  annualPriceCents: number;
  /** What it costs TODAY, day-prorated to this tenant's anniversary. */
  proratedCents: number;
  currency: string;
  periodEnd: string | null;
}

export interface RenewalSummary {
  cycleId: string;
  anniversaryAt: string;
  graceEndsAt: string;
  totalCents: number;
  currency: string;
  daysLeft: number;
}

export interface LicensingSnapshot {
  entitlements: EntitlementSet;
  license: LicenseState;
  credits: Record<string, number>;
  owned: OwnedProduct[];
  renewal: RenewalSummary | null;
  /** Grant key → the cheapest product that provides it, priced for today. */
  offers: Record<string, Offer>;
}

export const licensingKeys = {
  me: () => ['licensing', 'me'] as const,
  pricing: () => ['licensing', 'pricing'] as const,
};

/**
 * ONE request for everything the shell needs: entitlements, licence state,
 * credit balances, owned products, the open renewal, and the current price of
 * every purchasable capability.
 *
 * It replaces three separate calls the app used to make on every page load,
 * but the reason it exists is not the round trips — it is that the upsell
 * price and the checkout price now come from the same catalog read. The old
 * frontend derived upsell copy from a hardcoded feature→plan table that
 * nothing kept in sync with what the customer would actually be charged.
 */
export function useLicensing() {
  return useQuery({
    queryKey: licensingKeys.me(),
    queryFn: async () => {
      const { data } = await api.get<LicensingSnapshot>('/v1/me/licensing');
      return data;
    },
    // Short enough that a purchase shows up promptly, long enough that a
    // navigation-heavy session does not re-fetch on every screen. Any mutation
    // that changes entitlement invalidates this key explicitly.
    staleTime: 30_000,
  });
}

export interface PricingProduct {
  code: string;
  name: string;
  description: string | null;
  kind: string;
  billing: string;
  priceCents: number;
  currency: string;
  creditKind: string | null;
  creditUnits: number | null;
  requiresLicense: boolean;
  sortOrder: number;
}

export interface InvoiceLine {
  lineNo: number;
  kind: string;
  code: string;
  name: string;
  qty: number;
  unitCents: number;
  subtotalCents: number;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface TenantInvoice {
  id: string;
  invoiceNumber: string;
  status: string;
  kind: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  issuedAt: string;
  lines: InvoiceLine[];
}

/**
 * Itemized invoices for the à-la-carte world.
 *
 * Reads `tenant_invoices`, not the legacy `invoices` archive — the two coexist
 * deliberately (that table holds tax records behind a NOT NULL subscriptionId)
 * and only one of them describes a purchase anybody can still make.
 */
export function useTenantInvoices() {
  return useQuery({
    queryKey: ['licensing', 'invoices'] as const,
    queryFn: async () => {
      const { data } = await api.get<{ invoices: TenantInvoice[] }>(
        '/v1/me/invoices',
      );
      return data.invoices;
    },
    staleTime: 60_000,
  });
}

/** Public price list — the same rows checkout prices from. */
export function useCatalogPricing() {
  return useQuery({
    queryKey: licensingKeys.pricing(),
    queryFn: async () => {
      const { data } = await api.get<{ products: PricingProduct[] }>(
        '/v1/catalog/pricing',
      );
      return data.products;
    },
    staleTime: 5 * 60_000,
  });
}

/** Kuruş → "₺1.254,66". */
export function formatCents(cents: number, currency = 'TRY'): string {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}
