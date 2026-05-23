import { useMemo, useState } from 'react';
import { type CartItem, useListProducts, useQuoteCart, useConfirmCheckout, type HardwareProduct, type CartQuote } from './storeApi';

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
 */
const CATEGORIES = ['all', 'kds_screen', 'tablet', 'pos_terminal', 'printer', 'yazarkasa', 'bridge', 'scanner', 'caller_id'];

interface LocalCartLine {
  product: HardwareProduct;
  qty: number;
}

export default function StorePage() {
  const [category, setCategory] = useState<string>('all');
  const [cart, setCart] = useState<LocalCartLine[]>([]);
  const { data: products = [], isLoading } = useListProducts(category === 'all' ? undefined : category);
  const quote = useQuoteCart();
  const confirm = useConfirmCheckout();

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

  async function placeOrder() {
    if (cart.length === 0) return;
    // MVP: paymentRef placeholder. Real PayTR/Stripe redirect plugs in here.
    const paymentRef = `manual-${Date.now()}`;
    await confirm.mutateAsync({ cart: { items: cartItems }, paymentRef });
    setCart([]);
  }

  const currentQuote = (quote.data as CartQuote | undefined) ?? null;

  return (
    <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Hardware Store</h1>
          <select
            className="rounded border px-2 py-1 text-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c === 'all' ? 'All categories' : c.replace('_', ' ')}
              </option>
            ))}
          </select>
        </header>

        {isLoading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : products.length === 0 ? (
          <div className="rounded border border-dashed p-8 text-center text-sm text-gray-500">
            No products in this category.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {products.map((p) => (
              <article key={p.id} className="overflow-hidden rounded-lg border bg-white">
                {p.images?.[0] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.images[0]} alt={p.name} className="aspect-[4/3] w-full object-cover" />
                )}
                <div className="p-4">
                  <div className="text-xs text-gray-500">{p.brand} · {p.category}</div>
                  <h3 className="font-semibold">{p.name}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-gray-600">{p.description}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-lg font-medium">
                      {(p.priceCents / 100).toLocaleString('tr-TR', { style: 'currency', currency: p.currency })}
                    </span>
                    <button
                      className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                      disabled={p.stockStatus === 'out_of_stock' || p.stockStatus === 'discontinued'}
                      onClick={() => add(p)}
                    >
                      {p.stockStatus === 'out_of_stock' ? 'Out of stock' : 'Add to cart'}
                    </button>
                  </div>
                  <div className="mt-2 text-xs text-gray-500">{p.warrantyMonths} months warranty</div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <aside className="space-y-4 rounded-lg border bg-white p-4 lg:sticky lg:top-6 lg:self-start">
        <h2 className="text-lg font-semibold">Cart</h2>
        {cart.length === 0 ? (
          <p className="text-sm text-gray-500">Your cart is empty.</p>
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
                      Remove
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
              {quote.isPending ? 'Pricing…' : 'Get quote'}
            </button>
            {currentQuote && (
              <div className="space-y-1 rounded bg-gray-50 p-3 text-sm">
                <Row label="Subtotal" cents={currentQuote.subtotalCents} currency={currentQuote.currency} />
                <Row label="Tax" cents={currentQuote.taxCents} currency={currentQuote.currency} />
                <Row label="Shipping" cents={currentQuote.shippingCents} currency={currentQuote.currency} />
                <Row label="Total" cents={currentQuote.totalCents} currency={currentQuote.currency} bold />
              </div>
            )}
            <button
              className="w-full rounded bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={placeOrder}
              // Block clicks when there's nothing to provision or while a
              // confirm is mid-flight. Without the cart.length guard, the
              // button silently no-ops and operators re-click thinking the
              // page is frozen.
              disabled={confirm.isPending || cart.length === 0}
            >
              {confirm.isPending ? 'Placing…' : 'Place order'}
            </button>
          </>
        )}
      </aside>
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
