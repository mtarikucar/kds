import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';

export interface HardwareProduct {
  id: string;
  sku: string;
  // 'service' added in v2.8.87 — installation/integration offerings live
  // alongside hardware so the cart/checkout pipeline stays unified.
  category: string;
  name: string;
  brand: string | null;
  model: string | null;
  description: string | null;
  specs?: Record<string, unknown>;
  compat?: Record<string, unknown>;
  // v2.8.87 — rich detail JSON consumed by ProductDetailPage. Shape:
  //   { includes?: string[], requirements?: string[], faq?: {q,a}[],
  //     steps?: {title,body}[], videoUrl?, gallery?: string[] }
  // Per-locale variants supported via { tr: {...}, en: {...} }.
  details?: Record<string, unknown> | null;
  // v2.8.87 — service-only metadata. Shape:
  //   { durationHours?, geoCoverage?: string[], requiresBranch?: boolean,
  //     serviceType: 'onsite'|'remote'|'consultation' }
  serviceMeta?: Record<string, unknown> | null;
  priceCents: number;
  rentalMonthlyCents: number | null;
  currency: string;
  warrantyMonths: number;
  images: string[];
  stockStatus: 'in_stock' | 'preorder' | 'out_of_stock' | 'discontinued';
  // v2.8.87 — public view exposes this scalar so cards can show
  // "Son N adet" low-stock badge without leaking allocated/serials.
  available?: number;
  // Regulatory sale tier (TR law). Drives the storefront CTA. The server is
  // authoritative: the checkout guard blocks any non-DIRECT_SALE SKU.
  // Treat undefined as 'DIRECT_SALE' for back-compat.
  //   DIRECT_SALE      — normal buy (+ compliance docs shown)
  //   QUOTE_ONLY       — yazarkasa / YN ÖKC → "Teklif Al"
  //   PARTNER_REDIRECT — bank POS → redirect to a licensed bank/PSP
  //   RECOMMENDED_ONLY — uncertified scale etc. → recommended only, no CTA
  saleMode?: 'DIRECT_SALE' | 'QUOTE_ONLY' | 'PARTNER_REDIRECT' | 'RECOMMENDED_ONLY';
  // Tier 2 redirect target: { partnerName, partnerUrl, disclaimer? }
  partnerRedirect?: { partnerName?: string; partnerUrl?: string; disclaimer?: string } | null;
  // Tier 3 seller-responsibility docs (warranty, distributor, CE, manual, etc.)
  complianceDocs?: Record<string, string | boolean> | null;
}

export type SaleMode = NonNullable<HardwareProduct['saleMode']>;

/**
 * Single money formatter for the storefront — one decimals policy (cents
 * visible) so the store card and the product detail page can't disagree on
 * how the same SKU's price renders. currency is non-optional in the product
 * contract, so no 'TRY' fallback is needed.
 */
export function formatMoney(cents: number, currency: string, opts?: Intl.NumberFormatOptions): string {
  return (cents / 100).toLocaleString('tr-TR', { style: 'currency', currency, ...opts });
}

/**
 * Regulatory tier disclaimer copy (TR law). Shared by the store card and the
 * product detail page so the legally-meaningful wording stays identical across
 * both surfaces (no copy drift). null = no disclaimer for that tier.
 */
export const SALE_MODE_DISCLAIMER_TR: Record<SaleMode, string | null> = {
  DIRECT_SALE: null,
  QUOTE_ONLY:
    'Bu ürün doğrudan satışa kapalıdır; yetkili bayi/servis üzerinden teklif ve kurulum süreci başlatılır.',
  PARTNER_REDIRECT:
    'POS hizmeti HummyTummy tarafından değil, anlaşmalı banka/ödeme kuruluşu tarafından sağlanır.',
  RECOMMENDED_ONLY:
    'Bu ekipman yalnızca önerilen ekipman olarak listelenmiştir; doğrudan satışı yapılmamaktadır.',
};

export interface CartItem {
  type: 'plan' | 'addon' | 'hardware' | 'service';
  code?: string;
  sku?: string;
  qty?: number;
  billingCycle?: 'MONTHLY' | 'YEARLY';
  branchId?: string;
  acquisition?: 'sell' | 'rent';
  // v2.8.87: only meaningful for `service` items; forwarded to
  // InstallationRequest by the backend checkout pipeline.
  preferredDates?: string[]; // ISO YYYY-MM-DD, max 3
  notes?: string;            // max 500 chars
}

export interface PricedLine {
  type: string;
  code: string;
  name: string;
  qty: number;
  unitCents: number;
  subtotalCents: number;
  cadence: 'monthly' | 'yearly' | 'oneTime';
  meta?: Record<string, unknown>;
}

export interface CartQuote {
  lines: PricedLine[];
  currency: string;
  subtotalCents: number;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
  warnings: string[];
  isPureRecurring: boolean;
}

export const storeKeys = {
  products: (category?: string) => ['hardware-store', 'products', category] as const,
};

export const useListProducts = (category?: string) =>
  useQuery({
    queryKey: storeKeys.products(category),
    queryFn: async (): Promise<HardwareProduct[]> => {
      const r = await api.get('/v1/catalog/products', { params: category ? { category } : {} });
      return r.data;
    },
  });

export interface CatalogCategory {
  value: string;
  labelTr: string;
}

// Single source of truth for the category vocabulary — served by the backend
// (GET /v1/catalog/categories) so the storefront filter doesn't keep its own
// hand-synced copy that can drift from the @IsIn gate / seed.
export const useCategories = () =>
  useQuery({
    queryKey: ['hardware-store', 'categories'] as const,
    queryFn: async (): Promise<CatalogCategory[]> => {
      const r = await api.get('/v1/catalog/categories');
      return r.data;
    },
    staleTime: 60 * 60 * 1000, // vocabulary changes rarely
  });

// v2.8.87 — single-product fetch for /admin/store/:sku detail page.
export const useGetProductBySku = (sku: string | undefined) =>
  useQuery({
    queryKey: ['hardware-store', 'product', sku] as const,
    queryFn: async (): Promise<HardwareProduct> => {
      const r = await api.get(`/v1/catalog/products/sku/${encodeURIComponent(sku!)}`);
      return r.data;
    },
    enabled: Boolean(sku),
  });

// "Teklif Al" for a QUOTE_ONLY device (yazarkasa / YN ÖKC). These can't be
// bought directly — the request lands in the marketing lead board so a rep
// runs the authorized-dealer/service + GİB offer/installation process.
export interface HardwareQuoteRequest {
  sku: string;
  qty?: number;
  contactPerson: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export const useRequestQuote = () => {
  return useMutation({
    mutationFn: async (body: HardwareQuoteRequest) => {
      // Server emits a marketing outbox event (lead created async by the
      // marketing consumer), so the response is just an ack — no synchronous
      // leadId. The form only needs success/failure.
      const r = await api.post('/v1/catalog/quote-request', body);
      return r.data as { ok: boolean };
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.message ?? 'Teklif talebi gönderilemedi'),
  });
};

export const useQuoteCart = () => {
  return useMutation({
    mutationFn: async (cart: { items: CartItem[]; shippingAddress?: any }): Promise<CartQuote> => {
      const r = await api.post('/v1/checkout/quote', cart);
      return r.data;
    },
  });
};

export const useConfirmCheckout = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ cart, paymentRef }: { cart: { items: CartItem[]; shippingAddress?: any }; paymentRef: string }) => {
      const r = await api.post('/v1/checkout/confirm', { cart, paymentRef });
      return r.data;
    },
    onSuccess: () => {
      // v3.0.1 round-4 audit fix — targeted invalidation. Pre-fix this
      // called `qc.invalidateQueries()` with no key, which nuked the
      // entire query cache: every POS/KDS/orders/menu list refetched
      // immediately on the same tick. With a heavily-loaded admin
      // session this was the largest single jank source after a
      // hardware purchase. Hit only the surfaces the confirm flow
      // actually changes: subscriptions (entitlements + add-ons),
      // devices (a new device slot or activation may have been
      // provisioned), hardware orders (the new row), and marketplace
      // listings (capacity counters).
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
      qc.invalidateQueries({ queryKey: ['entitlements'] });
      qc.invalidateQueries({ queryKey: ['devices'] });
      qc.invalidateQueries({ queryKey: ['hardware-orders'] });
      qc.invalidateQueries({ queryKey: ['marketplace'] });
      toast.success('Order placed.');
    },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Checkout failed'),
  });
};

/* ---------------------------------------------------------------------------
 * v2.8.84 — shipping address + order history.
 *
 * v2.8.85 added POST /v1/checkout/intent which trades a cart for a PayTR
 * iframe token + persisted CheckoutIntent row. The webhook callback runs
 * confirmAndProvision against the persisted cart. The frontend's job:
 *   1. Collect shippingAddress + buyer info + cart, POST to /intent.
 *   2. Send the buyer to result.paymentLink (PayTR-hosted page).
 *   3. After the PayTR success page bounces them back, /hardware-orders
 *      shows the resulting order.
 * ------------------------------------------------------------------------- */

export interface ShippingAddress {
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string;
  district?: string;
  city: string;
  postalCode?: string;
  country: string;
}

export interface CheckoutBuyer {
  email: string;
  name: string;
  phone: string;
  address?: string;
}

export interface CheckoutIntentResponse {
  paymentRef: string;
  iframeToken: string;
  paymentLink: string;
  amountCents: number;
  currency: string;
  quote: CartQuote;
}

export const useCreateCheckoutIntent = () => {
  return useMutation({
    mutationFn: async (args: {
      cart: { items: CartItem[]; shippingAddress?: ShippingAddress; billingAddress?: ShippingAddress };
      buyer: CheckoutBuyer;
      returnUrl?: string;
      // v2.8.99.3 — "Ship to my branch" reference. When the buyer
      // picks one of their tenant's branches in ShippingAddressForm,
      // the SPA passes the branchId here AND copies the branch
      // address into `cart.shippingAddress` (snapshot). Backend
      // re-validates (tenant-owned + status='active') and writes to
      // HardwareOrder.branchId. Omitted on manual-address mode.
      branchId?: string;
    }): Promise<CheckoutIntentResponse> => {
      const r = await api.post('/v1/checkout/intent', args);
      return r.data;
    },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Ödeme başlatılamadı'),
  });
};

/* --------------------- Hardware orders (read-only) ----------------------- */

export interface HardwareOrderItem {
  id: string;
  productId: string;
  sku: string;
  name: string;
  qty: number;
  unitCents: number;
  serials: string[];
  acquisition: 'sell' | 'rent';
}

export interface HardwareOrderShipment {
  id: string;
  carrier: string;
  trackingNo: string | null;
  status: string;
  shippedAt: string | null;
  deliveredAt: string | null;
}

export interface HardwareOrderInstallation {
  id: string;
  status: string;
  scheduledAt: string | null;
  completedAt: string | null;
  notes: string | null;
}

export interface HardwareOrderSummary {
  id: string;
  status: string;
  subtotalCents: number;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
  currency: string;
  installation: string | null;
  paymentRef: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
}

export interface HardwareOrderDetail extends HardwareOrderSummary {
  branchId: string | null;
  shippingAddress: ShippingAddress | string | null;
  billingAddress: ShippingAddress | string | null;
  notes: string | null;
  items: HardwareOrderItem[];
  shipments: HardwareOrderShipment[];
  installations: HardwareOrderInstallation[];
}

export const hardwareOrderKeys = {
  list: (status?: string) => ['hardware-orders', 'list', status] as const,
  detail: (id: string) => ['hardware-orders', 'detail', id] as const,
};

export const useListHardwareOrders = (status?: string) =>
  useQuery({
    queryKey: hardwareOrderKeys.list(status),
    queryFn: async (): Promise<HardwareOrderSummary[]> => {
      const r = await api.get('/v1/hardware-orders', {
        params: status ? { status } : {},
      });
      return r.data;
    },
  });

export const useGetHardwareOrder = (id: string | undefined) =>
  useQuery({
    queryKey: hardwareOrderKeys.detail(id ?? ''),
    queryFn: async (): Promise<HardwareOrderDetail> => {
      const r = await api.get(`/v1/hardware-orders/${id}`);
      return r.data;
    },
    enabled: Boolean(id),
  });
