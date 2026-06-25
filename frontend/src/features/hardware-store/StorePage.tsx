import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ImageOff, AlertTriangle } from 'lucide-react';
import {
  useListProducts,
  useCategories,
  useQuoteCart,
  useCreateCheckoutIntent,
  formatMoney,
  SALE_MODE_DISCLAIMER_TR,
  type HardwareProduct,
  type CartQuote,
  type QuoteWarning,
  type ShippingAddress,
} from './storeApi';
import { useCartStore, toCartItems } from './cartStore';
import ShippingAddressForm from './ShippingAddressForm';
import Modal from '../../components/ui/Modal';
import { useAuthStore } from '../../store/authStore';
// v2.8.99.3 — pull the tenant's branches into the shipping form so
// the buyer can "ship to my branch" instead of typing a custom
// address.
import { useListBranches } from '../branches/branchesApi';

/**
 * Renders a product image but hides itself when the file is missing (404).
 * Until every SKU has a real photo in landing/public/products/, some
 * paths return 404 — without this fallback the browser shows the broken-
 * image icon. useState matches the landing's <ProductImage> pattern;
 * resets if the parent swaps a new src in (defensive even though product
 * cards key on id and unmount on swap).
 */
function ProductImage({ src, alt }: { src: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [src]);
  // A missing/404 image used to render nothing (the card looked half-broken).
  // Show a neutral placeholder so every card has a consistent visual.
  if (broken) {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center bg-slate-100 text-slate-300">
        <ImageOff className="h-8 w-8" aria-hidden="true" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setBroken(true)}
      className="aspect-[4/3] w-full object-cover"
    />
  );
}

/**
 * Tenant-facing hardware store. Three panels:
 *   - Catalogue grid (filtered by category).
 *   - Cart drawer with priced lines from the live /quote endpoint.
 *   - Confirm button that calls /checkout/confirm with a paymentRef
 *     placeholder; the real payment flow plugs in here once the
 *     subscription billing path is unified with hardware checkout.
 *
 * Keeps the cart state in-memory only — survives navigation within the SPA
 * but not a full reload, which is the right MVP behaviour (no half-finished
 * carts littering local storage).
 *
 * URL bridge: `?sku=<sku>` is read once on mount. If the public landing
 * store sends the visitor here with `?sku=…`, the matching product is
 * auto-added to the cart (idempotent — re-visiting doesn't stack). This
 * lets the landing's "Sipariş ver" CTA hand off a one-click checkout.
 */

// Category vocabulary (value + TR label) is fetched from the backend
// (GET /v1/catalog/categories, via useCategories) so the filter can't drift
// from the @IsIn gate / seed. The "all" sentinel is prepended client-side.
const ALL_CATEGORY = { value: 'all', labelTr: 'Tüm kategoriler' };

// LocalStorage key for the BYO disclaimer dismiss state. Versioned in case
// we update the copy later — bumping the suffix re-shows the banner.
const BYO_DISMISS_KEY = 'hardware-store-byo-dismiss-v1';

function gibCertified(p: HardwareProduct): boolean {
  return Boolean(p.compat && (p.compat as { gibCertified?: boolean }).gibCertified === true);
}

function headlineSpecs(p: HardwareProduct): string[] {
  const hs = p.specs && (p.specs as { headlineSpecs?: unknown[] }).headlineSpecs;
  if (!Array.isArray(hs)) return [];
  return hs.filter((s): s is string => typeof s === 'string').slice(0, 3);
}

// Regulatory tier — undefined means DIRECT_SALE (back-compat for rows seeded
// before saleMode existed). The server is authoritative; this only chooses
// which storefront CTA to render.
function saleModeOf(p: HardwareProduct): NonNullable<HardwareProduct['saleMode']> {
  return p.saleMode ?? 'DIRECT_SALE';
}

export default function StorePage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation('hardware');
  const [searchParams, setSearchParams] = useSearchParams();
  const [category, setCategory] = useState<string>('all');
  // v2.8.87: cart lives in the shared Zustand store so navigating to a
  // detail page and back doesn't drop the cart.
  const lines = useCartStore((s) => s.lines);
  const addHardware = useCartStore((s) => s.addHardware);
  const removeFromCart = useCartStore((s) => s.remove);
  const [byoDismissed, setByoDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(BYO_DISMISS_KEY) === '1';
  });

  // For the SKU bridge we need the unfiltered catalogue so a deeplink to a
  // product in a category that's not currently filtered still resolves.
  const { data: products = [], isLoading } = useListProducts(category === 'all' ? undefined : category);
  const { data: allProducts = [] } = useListProducts(undefined);
  // Category filter options from the backend vocabulary (single source).
  const { data: fetchedCategories = [] } = useCategories();
  const categoryOptions = [ALL_CATEGORY, ...fetchedCategories];
  const quote = useQuoteCart();
  const intent = useCreateCheckoutIntent();
  const user = useAuthStore((s) => s.user);
  // v2.8.99.3 — branches load lazily; ShippingAddressForm tolerates an
  // empty list (radio toggle hidden, behaves like pre-v2.8.99.3).
  const { data: branches = [] } = useListBranches();

  // v2.8.84: checkout is a two-step modal — shipping address first, then
  // PayTR redirect. shippingAddress is held in component state so a user
  // tweaking the cart after entering the address doesn't lose their typing.
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [shippingAddress, setShippingAddress] = useState<ShippingAddress | null>(null);

  // Auto-add the ?sku=<sku> product on mount. Guarded with `processed` so
  // re-renders + state changes don't keep adding. Once it's processed we
  // also strip the param from the URL so a refresh doesn't trigger again.
  useEffect(() => {
    const sku = searchParams.get('sku');
    if (!sku || allProducts.length === 0) return;
    const product = allProducts.find((p) => p.sku === sku);
    if (!product) {
      const next = new URLSearchParams(searchParams);
      next.delete('sku');
      setSearchParams(next, { replace: true });
      return;
    }
    // Services need a branch picker + dates; we send the buyer to the
    // detail page rather than auto-add. Non-DIRECT_SALE devices (yazarkasa
    // teklif, bank-POS redirect, recommended-only) likewise can't be
    // auto-carted — the detail page carries the right CTA. Hardware that is
    // directly sellable idempotently lands in the cart.
    if (
      product.category === 'service' ||
      (product.saleMode && product.saleMode !== 'DIRECT_SALE')
    ) {
      const next = new URLSearchParams(searchParams);
      next.delete('sku');
      setSearchParams(next, { replace: true });
      // Use replace so back button returns to the source, not the bare
      // /admin/store.
      window.history.replaceState(null, '', `/admin/store/${encodeURIComponent(sku)}`);
      window.location.assign(`/admin/store/${encodeURIComponent(sku)}`);
      return;
    }
    const already = lines.some((l) => l.product.id === product.id);
    if (!already) {
      addHardware(product, { qty: 1, acquisition: 'sell' });
    }
    const next = new URLSearchParams(searchParams);
    next.delete('sku');
    setSearchParams(next, { replace: true });
  }, [searchParams, allProducts, setSearchParams, addHardware, lines]);

  const cartItems = useMemo(() => toCartItems(lines), [lines]);

  function add(product: HardwareProduct) {
    // Only directly-sellable devices may be carted. QUOTE_ONLY /
    // PARTNER_REDIRECT / RECOMMENDED_ONLY are handled by their own CTAs;
    // this guard backs up the server-side checkout guard against accidental
    // adds.
    if ((product.saleMode ?? 'DIRECT_SALE') !== 'DIRECT_SALE') return;
    addHardware(product, { qty: 1, acquisition: 'sell' });
  }

  async function refreshQuote() {
    if (lines.length === 0) return null;
    return quote.mutateAsync({ items: cartItems });
  }

  async function startCheckout(result: { address: ShippingAddress; branchId?: string }) {
    if (lines.length === 0 || !user) return;
    const { address, branchId } = result;
    setShippingAddress(address);
    const intentResult = await intent.mutateAsync({
      cart: { items: cartItems, shippingAddress: address },
      buyer: {
        email: user.email,
        name: `${user.firstName} ${user.lastName}`.trim() || user.email,
        phone: (user as any).phone ?? '',
        address: `${address.line1}${address.line2 ? ', ' + address.line2 : ''}, ${address.city}`,
      },
      returnUrl: `${window.location.origin}/admin/store?tab=orders`,
      // v2.8.99.3 — top-level branchId so the backend stamps it onto
      // HardwareOrder.branchId. Address still in cart.shippingAddress
      // as the snapshot; branchId is the reference.
      branchId,
    });
    if (intentResult.paymentLink) {
      window.location.assign(intentResult.paymentLink);
    }
  }

  function dismissByo() {
    setByoDismissed(true);
    try {
      window.localStorage.setItem(BYO_DISMISS_KEY, '1');
    } catch {
      // Private mode / quota — non-fatal, banner just re-shows next session.
    }
  }

  const currentQuote = (quote.data as CartQuote | undefined) ?? null;

  // A fetched quote (totals + dropped-item warnings) goes stale the moment the
  // cart changes — react-query keeps mutation .data until reset(). Clear it on
  // any cart edit so the user re-quotes instead of seeing prices/warnings for a
  // cart they've since changed. cartItems is memoised on `lines`, so this fires
  // exactly when the cart content changes (not on unrelated re-renders).
  useEffect(() => {
    quote.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartItems]);

  // Render a dropped-line warning as a localized, name-bearing message. The
  // backend returns a structured { code, ref }; resolve ref→product name where
  // we have it (hardware SKUs are in the loaded catalogue) so the user sees the
  // product, not an internal SKU. Falls back to the ref when no name is known
  // (add-on / service / unknown codes).
  function warningText(w: QuoteWarning): string {
    const name = allProducts.find((p) => p.sku === w.ref)?.name ?? w.ref;
    return t(`store.warnings.${w.code}`, {
      name,
      defaultValue: t('store.warnings.generic', {
        name,
        defaultValue: '{{name}} bu siparişe eklenemiyor.',
      }),
    });
  }

  return (
    <div className="space-y-4 p-6">
      {/* BYO disclaimer banner — dismissible. */}
      {!byoDismissed && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <div>
            <strong className="font-semibold">{t('store.byoTitle')}</strong>{' '}
            {t('store.byoBody')}
          </div>
          <button
            type="button"
            onClick={dismissByo}
            className="text-blue-700 hover:text-blue-900 text-xs underline whitespace-nowrap"
          >
            {t('store.byoDismiss')}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <header className="flex items-center justify-between gap-4 flex-wrap">
            {!embedded && <h1 className="text-2xl font-semibold">{t('store.title')}</h1>}
            <select
              className="rounded border px-2 py-1 text-sm"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {categoryOptions.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.value === 'all' ? t('store.allCategories') : c.labelTr}
                </option>
              ))}
            </select>
          </header>

          {isLoading ? (
            <div className="text-sm text-gray-500">{t('store.loading')}</div>
          ) : products.length === 0 ? (
            <div className="rounded border border-dashed p-8 text-center text-sm text-gray-500">
              {t('store.emptyCategory')}
            </div>
          ) : (
            <>
              {/* v2.8.87: services rendered in a dedicated section above
                  hardware (only when the filter is 'all' or 'service'). */}
              {(category === 'all' || category === 'service') &&
                products.some((p) => p.category === 'service') && (
                  <section className="space-y-3">
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">
                        {t('store.servicesTitle')}
                      </h2>
                      <p className="text-xs text-gray-600">
                        {t('store.servicesSubtitle')}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {products
                        .filter((p) => p.category === 'service')
                        .map((p) => (
                          <ServiceCard key={p.id} p={p} />
                        ))}
                    </div>
                  </section>
                )}

              {/* Hardware grid — excludes service rows since they have their
                  own section. */}
              {products.some((p) => p.category !== 'service') && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {products
                    .filter((p) => p.category !== 'service')
                    .map((p) => (
                      <HardwareCard
                        key={p.id}
                        p={p}
                        onAdd={() => add(p)}
                      />
                    ))}
                </div>
              )}
            </>
          )}
        </div>

        <aside className="space-y-4 rounded-lg border bg-white p-4 lg:sticky lg:top-6 lg:self-start">
          <h2 className="text-lg font-semibold">{t('store.cart')}</h2>
          {lines.length === 0 ? (
            <p className="text-sm text-gray-500">{t('store.cartEmpty')}</p>
          ) : (
            <>
              <ul className="space-y-2">
                {lines.map((l) => {
                  const lineCents =
                    l.type === 'hardware' && l.acquisition === 'rent' && l.product.rentalMonthlyCents
                      ? l.product.rentalMonthlyCents * l.qty
                      : l.product.priceCents * l.qty;
                  return (
                    <li key={`${l.product.id}-${l.type === 'service' ? l.branchId ?? '_' : l.acquisition}`} className="flex items-start justify-between gap-2 text-sm">
                      <div className="flex-1 min-w-0">
                        <div className="truncate">
                          {l.product.name}{' '}
                          <span className="text-gray-500">× {l.qty}</span>
                        </div>
                        {l.type === 'hardware' && l.acquisition === 'rent' && (
                          <div className="text-[11px] text-gray-500">{t('store.rentMonthly')}</div>
                        )}
                        {l.type === 'service' && (
                          <div className="text-[11px] text-gray-500">
                            {t('store.service')}
                            {l.branchId ? t('store.serviceBranchAssigned') : ''}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="whitespace-nowrap">
                          {formatMoney(lineCents, l.product.currency)}
                        </span>
                        <button
                          className="text-xs text-red-600 hover:underline"
                          onClick={() => removeFromCart(l.product.id)}
                        >
                          {t('store.remove')}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <button
                className="w-full rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
                onClick={refreshQuote}
                disabled={quote.isPending}
              >
                {quote.isPending ? t('store.pricing') : t('store.getQuote')}
              </button>
              {currentQuote && (
                <div className="space-y-1 rounded bg-gray-50 p-3 text-sm">
                  <Row label={t('store.subtotal')} cents={currentQuote.subtotalCents} currency={currentQuote.currency} />
                  <Row label={t('store.tax')} cents={currentQuote.taxCents} currency={currentQuote.currency} />
                  <Row label={t('store.shipping')} cents={currentQuote.shippingCents} currency={currentQuote.currency} />
                  <Row label={t('store.total')} cents={currentQuote.totalCents} currency={currentQuote.currency} bold />
                </div>
              )}
              {/* Surface items the quote silently dropped (unpublished /
                  not directly purchasable) instead of letting them vanish.
                  These items aren't removed from the cart — they just can't be
                  part of THIS order — so the copy says so honestly. */}
              {currentQuote && currentQuote.warnings.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" aria-hidden="true" />
                  <div>
                    <p className="font-medium">
                      {t('store.warningsTitle', {
                        defaultValue: 'Bu ürünler siparişe eklenemiyor',
                      })}
                    </p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {currentQuote.warnings.map((w, i) => (
                        <li key={`${w.code}-${w.ref}-${i}`}>{warningText(w)}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              <button
                className="w-full rounded bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => setCheckoutOpen(true)}
                disabled={intent.isPending || lines.length === 0}
              >
                {intent.isPending ? t('store.redirecting') : t('store.checkout')}
              </button>
              <Link
                to="/admin/store?tab=orders"
                className="block w-full text-center text-xs text-blue-600 hover:underline"
              >
                {t('store.pastOrders')}
              </Link>
            </>
          )}
        </aside>
      </div>

      {/* v2.8.84: checkout modal — collects shipping address, then
          POST /v1/checkout/intent → redirect to PayTR. */}
      <Modal
        isOpen={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        title={t('store.deliveryInfo')}
        size="lg"
      >
        <p className="mb-4 text-xs text-gray-500">
          {t('store.deliveryNote')}
        </p>
        <ShippingAddressForm
          initial={shippingAddress ?? undefined}
          branches={branches}
          onSubmit={startCheckout}
          submitting={intent.isPending}
          submitLabel={t('store.payWithPaytr')}
        />
        <p className="mt-3 text-[11px] text-gray-500">
          {t('store.paytrNote')}
        </p>
      </Modal>
    </div>
  );
}

function Row({ label, cents, currency, bold }: { label: string; cents: number; currency: string; bold?: boolean }) {
  // Use the quote's actual currency rather than hard-coding TRY. A tenant
  // selling USD hardware must not see ₺ next to their cart total.
  // `tr-TR` locale still controls grouping/separator format, which is
  // appropriate for the dashboard's primary audience.
  return (
    <div className={`flex items-center justify-between ${bold ? 'border-t pt-1 font-medium' : ''}`}>
      <span>{label}</span>
      <span>{formatMoney(cents, currency)}</span>
    </div>
  );
}

// v2.8.87 — extracted card components. The hardware card carries the
// quick-add CTA + headline specs + low-stock chip. The service card is
// CTA-light (must hit detail page to fill branch + dates).

function HardwareCard({ p, onAdd }: { p: HardwareProduct; onAdd: () => void }) {
  const { t } = useTranslation('hardware');
  const showGib = gibCertified(p);
  const isOos = p.stockStatus === 'out_of_stock' || p.stockStatus === 'discontinued';
  const headline = headlineSpecs(p);
  const showLowStock = (p.available ?? 0) > 0 && (p.available ?? 0) <= 5;
  const mode = saleModeOf(p);
  const detailHref = `/admin/store/${encodeURIComponent(p.sku)}`;
  // Only trust an absolute http(s) URL as a clickable outbound link — guards
  // against a stored javascript:/data: payload (defense-in-depth; the server
  // also validates the scheme at publish time).
  const rawPartnerUrl = p.partnerRedirect?.partnerUrl;
  const partnerUrl =
    rawPartnerUrl && /^https?:\/\//i.test(rawPartnerUrl) ? rawPartnerUrl : undefined;
  return (
    <article className="overflow-hidden rounded-lg border bg-white">
      {p.images?.[0] && <ProductImage src={p.images[0]} alt={p.name} />}
      <div className="p-4">
        <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
          <span>
            {p.brand} · {p.category.replace(/_/g, ' ')}
          </span>
          {showGib && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
              {t('store.card.gibCertified')}
            </span>
          )}
          {mode === 'QUOTE_ONLY' && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
              {t('store.card.quoteOnly')}
            </span>
          )}
          {mode === 'PARTNER_REDIRECT' && (
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
              {t('store.card.partner')}
            </span>
          )}
          {mode === 'RECOMMENDED_ONLY' && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
              {t('store.card.recommended')}
            </span>
          )}
          {showLowStock && mode === 'DIRECT_SALE' && (
            <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700">
              {t('store.card.lastUnits', { count: p.available })}
            </span>
          )}
        </div>
        <h3 className="font-semibold mt-1">{p.name}</h3>
        {headline.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {headline.map((h, i) => (
              <span
                key={i}
                className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-700"
              >
                {h}
              </span>
            ))}
          </div>
        )}
        <p className="mt-1 line-clamp-2 text-sm text-gray-600">{p.description}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          {/* For non-DIRECT_SALE the price is a reference list price, not a
              sale price — qualify it so the card doesn't read as a firm
              "buy at this price" next to a "satışa kapalı" disclaimer. */}
          {mode === 'DIRECT_SALE' ? (
            <span className="text-lg font-medium">{formatMoney(p.priceCents, p.currency)}</span>
          ) : (
            <span className="text-sm text-gray-500">
              {t('store.card.list', { price: formatMoney(p.priceCents, p.currency) })}
            </span>
          )}
          {/* CTA branches by regulatory tier (TR law). Only DIRECT_SALE
              carts; the rest route to the detail page (full disclaimer +
              quote form) or out to a licensed bank/PSP. */}
          {mode === 'DIRECT_SALE' ? (
            <button
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isOos}
              onClick={onAdd}
            >
              {p.stockStatus === 'out_of_stock'
                ? t('store.card.outOfStock')
                : p.stockStatus === 'discontinued'
                  ? t('store.card.discontinued')
                  : t('store.card.addToCart')}
            </button>
          ) : mode === 'QUOTE_ONLY' ? (
            <Link
              to={detailHref}
              className="rounded bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-700"
            >
              {t('store.card.getQuote')}
            </Link>
          ) : mode === 'PARTNER_REDIRECT' ? (
            partnerUrl ? (
              <a
                href={partnerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700"
              >
                {t('store.card.goToProvider')}
              </a>
            ) : (
              <Link
                to={detailHref}
                className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700"
              >
                {t('store.card.details')}
              </Link>
            )
          ) : (
            <span className="rounded bg-slate-100 px-3 py-1.5 text-sm text-slate-600">
              {t('store.card.recommendedEquipment')}
            </span>
          )}
        </div>
        {mode === 'QUOTE_ONLY' && (
          <p className="mt-2 text-[11px] leading-snug text-amber-700">
            {SALE_MODE_DISCLAIMER_TR.QUOTE_ONLY}
          </p>
        )}
        {mode === 'PARTNER_REDIRECT' && (
          <p className="mt-2 text-[11px] leading-snug text-indigo-700">
            {SALE_MODE_DISCLAIMER_TR.PARTNER_REDIRECT}
          </p>
        )}
        <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
          <span>{t('store.card.warranty', { count: p.warrantyMonths })}</span>
          <Link to={detailHref} className="text-blue-600 hover:underline">
            {t('store.card.detailsLink')}
          </Link>
        </div>
      </div>
    </article>
  );
}

function ServiceCard({ p }: { p: HardwareProduct }) {
  const { t } = useTranslation('hardware');
  const meta = (p.serviceMeta ?? {}) as { serviceType?: string; durationHours?: number };
  const serviceLabel =
    meta.serviceType === 'remote'
      ? t('store.service_.remote')
      : meta.serviceType === 'consultation'
        ? t('store.service_.consultation')
        : t('store.service_.onsite');
  return (
    <article className="overflow-hidden rounded-lg border bg-gradient-to-br from-blue-50/50 to-white">
      <div className="p-4">
        <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
            {serviceLabel}
          </span>
          {meta.durationHours && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
              {t('store.service_.hours', { count: meta.durationHours })}
            </span>
          )}
        </div>
        <h3 className="font-semibold mt-1">{p.name}</h3>
        <p className="mt-1 line-clamp-3 text-sm text-gray-600">{p.description}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-lg font-medium">
            {formatMoney(p.priceCents, p.currency)}
          </span>
          <Link
            to={`/admin/store/${encodeURIComponent(p.sku)}`}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            {t('store.service_.details')}
          </Link>
        </div>
      </div>
    </article>
  );
}
