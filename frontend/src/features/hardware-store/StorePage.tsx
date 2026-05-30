import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  type CartItem,
  useListProducts,
  useQuoteCart,
  useCreateCheckoutIntent,
  type HardwareProduct,
  type CartQuote,
  type ShippingAddress,
} from './storeApi';
import ShippingAddressForm from './ShippingAddressForm';
import { useAuthStore } from '../../store/authStore';

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
  if (broken) return null;
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

// Categories must match the backend CreateHardwareProductDto enum
// (see backend/src/modules/catalog/dto/create-hardware-product.dto.ts).
const CATEGORIES = [
  'all',
  'yazarkasa',
  'pos_terminal',
  'printer',
  'kds_screen',
  'tablet',
  'scanner',
  'caller_id',
  'cash_drawer',
  'bridge',
  'scale',
  'cable',
  'accessory',
  'service',
];

const CATEGORY_LABELS_TR: Record<string, string> = {
  all: 'Tüm kategoriler',
  yazarkasa: 'Yazarkasa POS',
  pos_terminal: 'POS Terminal',
  printer: 'Yazıcı',
  kds_screen: 'KDS Ekranı',
  tablet: 'Tablet',
  scanner: 'Barkod Okuyucu',
  caller_id: 'Arayan Numara',
  cash_drawer: 'Para Çekmecesi',
  bridge: 'Network Bridge',
  scale: 'Tartı',
  cable: 'Kablo',
  accessory: 'Aksesuar',
  service: 'Hizmet',
};

// LocalStorage key for the BYO disclaimer dismiss state. Versioned in case
// we update the copy later — bumping the suffix re-shows the banner.
const BYO_DISMISS_KEY = 'hardware-store-byo-dismiss-v1';

interface LocalCartLine {
  product: HardwareProduct;
  qty: number;
}

function gibCertified(p: HardwareProduct): boolean {
  return Boolean(p.compat && (p.compat as { gibCertified?: boolean }).gibCertified === true);
}

export default function StorePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [category, setCategory] = useState<string>('all');
  const [cart, setCart] = useState<LocalCartLine[]>([]);
  const [byoDismissed, setByoDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(BYO_DISMISS_KEY) === '1';
  });

  // For the SKU bridge we need the unfiltered catalogue so a deeplink to a
  // product in a category that's not currently filtered still resolves.
  const { data: products = [], isLoading } = useListProducts(category === 'all' ? undefined : category);
  const { data: allProducts = [] } = useListProducts(undefined);
  const quote = useQuoteCart();
  const intent = useCreateCheckoutIntent();
  const user = useAuthStore((s) => s.user);

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
      // Strip the param even if we couldn't resolve the sku — otherwise
      // every re-render tries again as the catalogue list shuffles.
      const next = new URLSearchParams(searchParams);
      next.delete('sku');
      setSearchParams(next, { replace: true });
      return;
    }
    setCart((c) => {
      if (c.some((l) => l.product.id === product.id)) return c;
      return [...c, { product, qty: 1 }];
    });
    const next = new URLSearchParams(searchParams);
    next.delete('sku');
    setSearchParams(next, { replace: true });
  }, [searchParams, allProducts, setSearchParams]);

  const cartItems: CartItem[] = useMemo(
    () => cart.map((l) => ({ type: 'hardware' as const, sku: l.product.sku, qty: l.qty })),
    [cart],
  );

  function add(product: HardwareProduct) {
    setCart((c) => {
      const idx = c.findIndex((l) => l.product.id === product.id);
      if (idx >= 0) {
        const next = [...c];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...c, { product, qty: 1 }];
    });
  }

  function remove(productId: string) {
    setCart((c) => c.filter((l) => l.product.id !== productId));
  }

  async function refreshQuote() {
    if (cart.length === 0) return null;
    return quote.mutateAsync({ items: cartItems });
  }

  async function startCheckout(address: ShippingAddress) {
    if (cart.length === 0 || !user) return;
    // v2.8.84/85: POST /v1/checkout/intent — server re-prices, persists a
    // CheckoutIntent row, asks PayTR for an iframe token, returns the
    // paymentLink we redirect to. The webhook side (CheckoutSettlement
    // Service) provisions the order once PayTR confirms.
    setShippingAddress(address);
    const result = await intent.mutateAsync({
      cart: { items: cartItems, shippingAddress: address },
      buyer: {
        email: user.email,
        name: `${user.firstName} ${user.lastName}`.trim() || user.email,
        // The phone-prompt flow (#71) makes phone reliably present on the
        // user record. Fall back to a placeholder ONLY for legacy admins
        // whose record predates the prompt — the backend DTO will reject
        // empty/invalid phones at the boundary.
        phone: (user as any).phone ?? '',
        address: `${address.line1}${address.line2 ? ', ' + address.line2 : ''}, ${address.city}`,
      },
      returnUrl: `${window.location.origin}/admin/hardware-orders`,
    });
    // Redirect to the PayTR-hosted iframe. We use top-level navigation
    // rather than a popup so the iframe lifecycle is browser-native and
    // 3DS / OTP flows don't get blocked by popup blockers.
    if (result.paymentLink) {
      window.location.assign(result.paymentLink);
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

  return (
    <div className="space-y-4 p-6">
      {/* BYO disclaimer banner — dismissible. */}
      {!byoDismissed && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <div>
            <strong className="font-semibold">Mevcut donanımınız var mı?</strong>{' '}
            Elinizdeki yazarkasa POS, termal yazıcı veya KDS ekranını da entegre edebiliriz —
            yeni cihaz almak zorunda değilsiniz. Marka/model bilgisini destek ekibine iletmeniz yeterli.
          </div>
          <button
            type="button"
            onClick={dismissByo}
            className="text-blue-700 hover:text-blue-900 text-xs underline whitespace-nowrap"
          >
            Anladım, kapat
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <header className="flex items-center justify-between gap-4 flex-wrap">
            <h1 className="text-2xl font-semibold">Donanım Mağazası</h1>
            <select
              className="rounded border px-2 py-1 text-sm"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS_TR[c] ?? c.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </header>

          {isLoading ? (
            <div className="text-sm text-gray-500">Yükleniyor…</div>
          ) : products.length === 0 ? (
            <div className="rounded border border-dashed p-8 text-center text-sm text-gray-500">
              Bu kategoride ürün yok.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {products.map((p) => {
                const showGibBadge = gibCertified(p);
                const isOos = p.stockStatus === 'out_of_stock' || p.stockStatus === 'discontinued';
                return (
                  <article key={p.id} className="overflow-hidden rounded-lg border bg-white">
                    {p.images?.[0] && <ProductImage src={p.images[0]} alt={p.name} />}
                    <div className="p-4">
                      <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
                        <span>{p.brand} · {p.category.replace(/_/g, ' ')}</span>
                        {showGibBadge && (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                            GİB onaylı
                          </span>
                        )}
                      </div>
                      <h3 className="font-semibold mt-1">{p.name}</h3>
                      <p className="mt-1 line-clamp-2 text-sm text-gray-600">{p.description}</p>
                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-lg font-medium">
                          {(p.priceCents / 100).toLocaleString('tr-TR', { style: 'currency', currency: p.currency })}
                        </span>
                        <button
                          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={isOos}
                          onClick={() => add(p)}
                        >
                          {p.stockStatus === 'out_of_stock'
                            ? 'Stokta yok'
                            : p.stockStatus === 'discontinued'
                              ? 'Üretimden kaldırıldı'
                              : 'Sepete ekle'}
                        </button>
                      </div>
                      <div className="mt-2 text-xs text-gray-500">{p.warrantyMonths} ay garanti</div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <aside className="space-y-4 rounded-lg border bg-white p-4 lg:sticky lg:top-6 lg:self-start">
          <h2 className="text-lg font-semibold">Sepet</h2>
          {cart.length === 0 ? (
            <p className="text-sm text-gray-500">Sepetiniz boş.</p>
          ) : (
            <>
              <ul className="space-y-2">
                {cart.map((l) => (
                  <li key={l.product.id} className="flex items-center justify-between text-sm">
                    <span>
                      {l.product.name} <span className="text-gray-500">× {l.qty}</span>
                    </span>
                    <div className="flex items-center gap-2">
                      <span>
                        {((l.product.priceCents * l.qty) / 100).toLocaleString('tr-TR', { style: 'currency', currency: l.product.currency })}
                      </span>
                      <button className="text-xs text-red-600 hover:underline" onClick={() => remove(l.product.id)}>
                        Çıkar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <button
                className="w-full rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
                onClick={refreshQuote}
                disabled={quote.isPending}
              >
                {quote.isPending ? 'Fiyatlandırılıyor…' : 'Teklif al'}
              </button>
              {currentQuote && (
                <div className="space-y-1 rounded bg-gray-50 p-3 text-sm">
                  <Row label="Ara toplam" cents={currentQuote.subtotalCents} currency={currentQuote.currency} />
                  <Row label="KDV" cents={currentQuote.taxCents} currency={currentQuote.currency} />
                  <Row label="Kargo" cents={currentQuote.shippingCents} currency={currentQuote.currency} />
                  <Row label="Toplam" cents={currentQuote.totalCents} currency={currentQuote.currency} bold />
                </div>
              )}
              <button
                className="w-full rounded bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => setCheckoutOpen(true)}
                // Block clicks when there's nothing to provision or while a
                // confirm is mid-flight. Without the cart.length guard, the
                // button silently no-ops and operators re-click thinking the
                // page is frozen.
                disabled={intent.isPending || cart.length === 0}
              >
                {intent.isPending ? 'Yönlendiriliyor…' : 'Ödemeye geç'}
              </button>
              <Link
                to="/admin/hardware-orders"
                className="block w-full text-center text-xs text-blue-600 hover:underline"
              >
                Geçmiş siparişlerim →
              </Link>
            </>
          )}
        </aside>
      </div>

      {/* v2.8.84: checkout modal — collects shipping address, then
          POST /v1/checkout/intent → redirect to PayTR. */}
      {checkoutOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Teslimat bilgileri</h2>
              <button
                type="button"
                onClick={() => setCheckoutOpen(false)}
                className="text-sm text-gray-500 hover:text-gray-700"
                aria-label="Kapat"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 mb-4 text-xs text-gray-500">
              Donanımınız bu adrese kargolanacak. Bilgiler güvenli PayTR ödeme sayfasına aktarılacaktır.
            </p>
            <ShippingAddressForm
              initial={shippingAddress ?? undefined}
              onSubmit={startCheckout}
              submitting={intent.isPending}
              submitLabel="PayTR ile öde"
            />
            <p className="mt-3 text-[11px] text-gray-500">
              Ödeme işlemi PayTR tarafından güvenli olarak gerçekleştirilir.
              Kart bilgileriniz HummyTummy ile paylaşılmaz.
            </p>
          </div>
        </div>
      )}
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
      <span>{(cents / 100).toLocaleString('tr-TR', { style: 'currency', currency })}</span>
    </div>
  );
}
