import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Lock, Minus, Plus, ShoppingCart } from 'lucide-react';
import { useEntitlements } from '../../contexts/SubscriptionContext';
import {
  formatCents,
  PricingProduct,
  useCatalogPricing,
} from './licensingApi';
import { usePurchaseAddOnViaCheckout } from '../marketplace/marketplaceApi';
import CheckoutConsent, { useConsentComplete } from '../legal/CheckoutConsent';
import Button from '../../components/ui/Button';

/** Display order of the catalog sections. */
const KIND_ORDER = [
  'license',
  'module',
  'integration',
  'capacity',
  'credit',
  'service',
] as const;

/** Kinds you can hold more than one of, so they get a quantity stepper. */
const COUNTABLE_KINDS = new Set(['capacity', 'credit']);

const LICENCE_CODE = 'license_annual';

/**
 * Semt is in the delivery bundle's future, not in the catalog.
 *
 * It has no `marketplace_addons` row, no price and nothing to tick: a
 * published zero-price row would punch straight through purchase()'s payment
 * gate (catalog-validation.ts:242-250). So the storefront advertises it as a
 * static, unbuyable line — no button, no checkbox, no network call.
 */
const SemtComingSoonRow = () => {
  const { t } = useTranslation(['licensing', 'common']);
  return (
    <li
      data-testid="semt-coming-soon"
      className="flex items-start justify-between gap-4 px-4 py-3"
    >
      <div>
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {t('licensing:store.semt.title')}
        </p>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {t('licensing:store.semt.description')}
        </p>
      </div>
      <span className="shrink-0 rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-inset ring-sky-200/60 dark:bg-sky-950/40 dark:text-sky-300">
        {t('licensing:store.semt.badge')}
      </span>
    </li>
  );
};

/**
 * The à-la-carte storefront, built as a bill rather than a wall of cards.
 *
 * Products are sold individually, and buying them one card at a time meant one
 * checkout — one consent, one card entry, one PayTR round trip — per product,
 * with the running cost never shown anywhere. A tenant kitting out a new
 * restaurant wants the licence, two modules and a credit pack, and wants to
 * know what that comes to before they commit. So: tick what you want, watch the
 * total, pay once.
 *
 * Every line shows two numbers, because either alone misleads. The prorated
 * price is what this tenant pays TODAY — a mid-year purchase runs only to the
 * anniversary — and the annual price is what it costs at renewal. Both come
 * from the licensing snapshot, the same catalog read checkout prices from, so
 * the total on screen is the total charged.
 */
const CatalogStore = ({ focusCode }: { focusCode?: string }) => {
  const { t } = useTranslation(['licensing', 'common']);
  const { data: products, isLoading } = useCatalogPricing();
  const { license, snapshot } = useEntitlements();
  const purchase = usePurchaseAddOnViaCheckout();
  const [busy, setBusy] = useState(false);
  // code → quantity. Absent means unticked.
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [acceptedDocs, setAcceptedDocs] = useState<string[]>([]);
  const consentGiven = useConsentComplete(acceptedDocs);

  /**
   * Can this product be bought — the SERVER's answer, not ours.
   *
   * The store used to ask "is there an ownership row?", which is a different
   * question from the one checkout asks ("is this already covered by your
   * entitlements?"). Anything granted without a row — a comp, an operator
   * override, the whole demo tenant — was offered for sale and then refused at
   * checkout with ADDON_ALREADY_GRANTED, taking the rest of the basket with
   * it, because one rejected line fails the cart.
   */
  const blockedReason = (code: string): string | null => {
    const verdict = snapshot?.purchasability?.[code];
    return verdict && !verdict.ok ? (verdict.reason ?? 'BLOCKED') : null;
  };

  // Offers are keyed by GRANT key, not by product code, so index them by code
  // once rather than guessing which key a product happens to grant.
  const offerByCode = useMemo(() => {
    const map = new Map<string, { proratedCents: number; periodEnd: string | null }>();
    for (const offer of Object.values(snapshot?.offers ?? {})) {
      map.set(offer.code, {
        proratedCents: offer.proratedCents,
        periodEnd: offer.periodEnd,
      });
    }
    return map;
  }, [snapshot]);

  const byCode = useMemo(() => {
    const map = new Map<string, PricingProduct>();
    for (const product of products ?? []) map.set(product.code, product);
    return map;
  }, [products]);

  const grouped = useMemo(() => {
    const by = new Map<string, PricingProduct[]>();
    for (const product of products ?? []) {
      if (!by.has(product.kind)) by.set(product.kind, []);
      by.get(product.kind)!.push(product);
    }
    return by;
  }, [products]);

  // Arriving from an upsell ("buy Personnel to continue") should land with that
  // line already ticked — the customer already said what they wanted.
  useEffect(() => {
    if (!focusCode || !byCode.has(focusCode) || blockedReason(focusCode)) return;
    setPicked((prev) => (focusCode in prev ? prev : { ...prev, [focusCode]: 1 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCode, byCode, snapshot]);

  // Grace counts as having a licence: the capability is live and buying a
  // second one is refused. Only 'none' and 'expired' need one added.
  const needsLicence = license.status === 'none' || license.status === 'expired';

  /** Today's price for one unit — prorated when the engine priced it. */
  const unitCents = (product: PricingProduct) =>
    offerByCode.get(product.code)?.proratedCents ?? product.priceCents;

  const pickedLines = useMemo(
    () =>
      Object.entries(picked)
        .map(([code, qty]) => ({ product: byCode.get(code), qty }))
        .filter((l): l is { product: PricingProduct; qty: number } => !!l.product),
    [picked, byCode],
  );

  // The licence rides along when something on the bill needs one: the server
  // rejects a licence-gated line without it, and letting the customer discover
  // that at the payment page would be hostile. Shown as a real line, never a
  // surprise on the receipt.
  const licenceAutoAdded =
    needsLicence &&
    !(LICENCE_CODE in picked) &&
    pickedLines.some((l) => l.product.requiresLicense);

  // Codes that SATISFY a dependency: ACTIVE ownership only. purchase()'s dep
  // check is ACTIVE-only (tenant-marketplace.service.ts:229-242), so treating
  // a past_due parent as "owned" would leave the prerequisite off the bill and
  // the whole cart would 409 at intent.
  const activeOwnedCodes = useMemo(
    () =>
      new Set(
        (snapshot?.owned ?? [])
          .filter((o) => o.status === 'active')
          .map((o) => o.code),
      ),
    [snapshot],
  );

  /** Transitively collect the prerequisites of every ticked line. */
  const depAutoAdded = useMemo(() => {
    const out = new Map<string, PricingProduct>();
    const seen = new Set<string>();
    const walk = (code: string) => {
      if (seen.has(code)) return;
      seen.add(code);
      for (const dep of byCode.get(code)?.deps ?? []) {
        if (activeOwnedCodes.has(dep) || dep in picked || out.has(dep)) {
          walk(dep);
          continue;
        }
        const depProduct = byCode.get(dep);
        // Putting a line the server calls unpurchasable into the cart makes
        // the server reject the ENTIRE cart. Such a row is shown blocked
        // instead (see dependencyBlocked below) and never auto-added.
        if (!depProduct || blockedReason(dep)) continue;
        out.set(dep, depProduct);
        walk(dep);
      }
    };
    for (const code of Object.keys(picked)) walk(code);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, byCode, activeOwnedCodes, snapshot]);

  /**
   * The dependency this product needs but cannot get — neither actively owned
   * nor purchasable. Returning the dep CODE (not a boolean) lets the row name
   * it in the message.
   */
  const dependencyBlocked = (product: PricingProduct): string | null => {
    for (const dep of product.deps ?? []) {
      if (activeOwnedCodes.has(dep) || dep in picked) continue;
      if (!byCode.has(dep) || blockedReason(dep)) return dep;
    }
    return null;
  };

  const licenceProduct = byCode.get(LICENCE_CODE);
  const billLines = useMemo(() => {
    const lines = [...pickedLines];
    // Reading order on the receipt: licence → parent module → what was ticked.
    for (const product of [...depAutoAdded.values()].reverse()) {
      lines.unshift({ product, qty: 1 });
    }
    if (licenceAutoAdded && licenceProduct) {
      lines.unshift({ product: licenceProduct, qty: 1 });
    }
    return lines;
  }, [pickedLines, depAutoAdded, licenceAutoAdded, licenceProduct]);

  const totalCents = billLines.reduce(
    (sum, l) => sum + unitCents(l.product) * l.qty,
    0,
  );
  // What the same basket costs at the next renewal: full list, no proration.
  const renewalCents = billLines.reduce(
    (sum, l) => (l.product.billing === 'annual' ? sum + l.product.priceCents * l.qty : sum),
    0,
  );

  const toggle = (product: PricingProduct) =>
    setPicked((prev) => {
      const next = { ...prev };
      if (product.code in next) delete next[product.code];
      else next[product.code] = 1;
      return next;
    });

  const setQty = (code: string, qty: number) =>
    setPicked((prev) => ({ ...prev, [code]: Math.max(1, Math.min(99, qty)) }));

  const pay = async () => {
    if (billLines.length === 0 || !consentGiven) return;
    setBusy(true);
    try {
      await purchase.mutateAsync({
        items: billLines.map((l) => ({
          type: 'addon' as const,
          code: l.product.code,
          qty: l.qty,
        })),
        acceptedDocumentIds: acceptedDocs,
      });
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return <div className="p-6 text-sm text-gray-500">{t('common:loading')}</div>;
  }

  if (grouped.size === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-500">{t('licensing:store.empty')}</p>
        {/* Second render site, and not optional: a tenant whose filtered
            catalog is empty takes this branch and would otherwise never see
            that Semt is coming. */}
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
          <SemtComingSoonRow />
        </ul>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      {/* ── The checklist ───────────────────────────────────────────── */}
      <div className="space-y-6">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('licensing:store.checklistHint')}
        </p>

        {/* Said once, here, rather than on each gated row. Repeated per line it
            was noise — it appeared on products the tenant already owns, and it
            kept promising to add a licence that was already on the bill. When
            it becomes relevant the licence shows up as a real line, labelled. */}
        {needsLicence && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            {t('licensing:store.licenceFirst')}
          </p>
        )}

        {KIND_ORDER.filter((k) => grouped.has(k)).map((kind) => (
          <section key={kind}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {t(`licensing:store.kind.${kind}`)}
            </h2>
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
              {kind === 'integration' && <SemtComingSoonRow />}
              {grouped.get(kind)!.map((product) => {
                // Credits and extra branches are bought repeatedly; a module is
                // owned once, so owning it takes it off the menu.
                const repeatable = COUNTABLE_KINDS.has(product.kind);
                const blocked = blockedReason(product.code);
                // A blocked line is unbuyable for a reason the server named.
                // `LICENSE_REQUIRED` is not one of them here: the store adds
                // the licence itself, so those stay tickable.
                const isOwned = !!blocked && blocked !== 'LICENSE_REQUIRED';
                const depBlocked = dependencyBlocked(product);
                const unbuyable = isOwned || !!depBlocked;
                const isLicenceAuto =
                  product.code === LICENCE_CODE && licenceAutoAdded;
                const checked = product.code in picked || isLicenceAuto;
                const qty = picked[product.code] ?? 1;
                const today = unitCents(product);
                const prorated =
                  product.billing === 'annual' && today !== product.priceCents;
                const offer = offerByCode.get(product.code);

                return (
                  <li
                    key={product.code}
                    id={`product-${product.code}`}
                    className={
                      focusCode === product.code
                        ? 'bg-blue-50/60 dark:bg-blue-950/30'
                        : undefined
                    }
                  >
                    <label
                      className={`flex items-start gap-3 p-3 sm:p-4 ${
                        unbuyable || isLicenceAuto
                          ? 'cursor-default'
                          : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-60"
                        checked={isOwned || checked}
                        disabled={unbuyable || isLicenceAuto}
                        onChange={() => {
                          // `disabled` stops a real click, but a dispatched
                          // change event is not gated by the DOM the same
                          // way — without this guard a line the server would
                          // refuse (owned, max-quantity, or an unmet
                          // dependency) could still be forced into the cart.
                          if (unbuyable || isLicenceAuto) return;
                          toggle(product);
                        }}
                        aria-label={product.name}
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            {product.name}
                          </span>
                          {isOwned && (
                            <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                              <Check size={12} />
                              {blocked === 'ADDON_MAX_QUANTITY'
                                ? t('licensing:store.maxReached')
                                : t('licensing:store.owned')}
                            </span>
                          )}
                          {isLicenceAuto && (
                            <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                              <Lock size={12} />
                              {t('licensing:store.licenceAuto')}
                            </span>
                          )}
                        </div>
                        {product.description && (
                          <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
                            {product.description}
                          </p>
                        )}
                        {depBlocked && (
                          <span className="block text-xs text-amber-600 dark:text-amber-400">
                            {t('licensing:store.blocked.dependencyUnavailable', {
                              dep: byCode.get(depBlocked)?.name ?? depBlocked,
                            })}
                          </span>
                        )}
                        {checked && repeatable && !isOwned && (
                          <div
                            className="mt-2 inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700"
                            // The stepper lives inside the row's <label>; without
                            // this the browser forwards its clicks to the
                            // checkbox and every +/- also unticks the line.
                            onClick={(e) => e.preventDefault()}
                          >
                            <button
                              type="button"
                              onClick={() => setQty(product.code, qty - 1)}
                              disabled={qty <= 1}
                              aria-label={t('licensing:store.decrease')}
                              className="px-2 py-1 text-gray-600 disabled:opacity-40 dark:text-gray-400"
                            >
                              <Minus size={14} />
                            </button>
                            <span className="min-w-[2ch] text-center text-sm tabular-nums">
                              {qty}
                            </span>
                            <button
                              type="button"
                              onClick={() => setQty(product.code, qty + 1)}
                              aria-label={t('licensing:store.increase')}
                              className="px-2 py-1 text-gray-600 dark:text-gray-400"
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="shrink-0 text-end">
                        <div className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                          {formatCents(today, product.currency)}
                        </div>
                        <div className="text-xs text-gray-500">
                          {prorated
                            ? t('licensing:store.thenPerYear', {
                                annual: formatCents(product.priceCents, product.currency),
                              })
                            : product.billing === 'annual'
                              ? t('licensing:store.perYear')
                              : t('licensing:store.oneTime')}
                        </div>
                        {prorated && offer?.periodEnd && (
                          <div className="text-xs text-gray-400">
                            {t('licensing:store.untilDate', {
                              date: new Date(offer.periodEnd).toLocaleDateString('tr-TR'),
                            })}
                          </div>
                        )}
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {/* On a phone the bill sits below the whole catalog, so ticking a line
            gives no feedback until you scroll past every section. Mirrors the POS
            sticky cart bar (components/pos/StickyCartBar): running total always
            visible, one tap to act. Hidden at lg, where the bill is beside the
            list and already in view. */}
        {billLines.length > 0 && (
          // sticky to the page's own scroll box, not fixed to the viewport:
          // between 768px and 1023px `lg:hidden` still renders this bar while
          // the sidebar is already docked at 256px, so a viewport-fixed bar put
          // its running total and its "N seçildi" label behind the sidebar.
          // It sits at the end of the tall catalog column so it has somewhere
          // to travel — a sticky box whose containing block is no taller than
          // itself never actually sticks.
          <div className="sticky bottom-0 z-40 border-t border-gray-200 bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md dark:border-gray-800 dark:bg-gray-900/95 lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-gray-500">
                  {t('licensing:store.selectedCount', { count: billLines.length })}
                </div>
                <div className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                  {formatCents(totalCents)}
                </div>
              </div>
              <Button
                onClick={() => {
                  // Consent lives in the bill. Sending them there beats a
                  // disabled button with no explanation of what to do about it.
                  if (!consentGiven) {
                    document
                      .getElementById('catalog-bill')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    return;
                  }
                  void pay();
                }}
                disabled={busy}
                className="shrink-0"
              >
                <ShoppingCart size={16} className="mr-1" />
                {consentGiven
                  ? t('licensing:store.pay')
                  : t('licensing:store.reviewBill')}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── The bill ────────────────────────────────────────────────── */}
      <aside
        id="catalog-bill"
        className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 lg:sticky lg:top-6"
      >
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t('licensing:store.billTitle')}
        </h2>

        {billLines.length === 0 ? (
          <p className="text-sm text-gray-500">{t('licensing:store.billEmpty')}</p>
        ) : (
          <ul className="space-y-2">
            {billLines.map((line) => (
              <li
                key={line.product.code}
                className="flex items-start justify-between gap-3 text-sm"
              >
                <span className="min-w-0 text-gray-700 dark:text-gray-300">
                  {line.product.name}
                  {line.qty > 1 && (
                    <span className="text-gray-500"> ×{line.qty}</span>
                  )}
                  {line.product.code === LICENCE_CODE && licenceAutoAdded && (
                    <span className="block text-xs text-amber-600 dark:text-amber-400">
                      {t('licensing:store.licenceAuto')}
                    </span>
                  )}
                  {depAutoAdded.has(line.product.code) && (
                    <span className="block text-xs text-amber-600 dark:text-amber-400">
                      {t('licensing:store.depAutoAddedNote')}
                    </span>
                  )}
                </span>
                <span className="shrink-0 tabular-nums text-gray-900 dark:text-gray-100">
                  {formatCents(unitCents(line.product) * line.qty, line.product.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-gray-200 pt-3 dark:border-gray-800">
          <div className="flex items-center justify-between">
            <span className="font-medium text-gray-900 dark:text-gray-100">
              {t('licensing:store.total')}
            </span>
            <span className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">
              {formatCents(totalCents)}
            </span>
          </div>
          {renewalCents > 0 && (
            // Today's figure is prorated to the anniversary, so it is smaller
            // than the recurring cost. Saying only the small number would set
            // the wrong expectation for next year.
            <p className="mt-1 text-xs text-gray-500">
              {t('licensing:store.renewalNote', {
                amount: formatCents(renewalCents),
              })}
            </p>
          )}
        </div>

        <div className="border-t border-gray-200 pt-3 dark:border-gray-800">
          <h3 className="mb-2 text-xs font-semibold text-gray-900 dark:text-gray-100">
            {t('licensing:consent.title')}
          </h3>
          <CheckoutConsent accepted={acceptedDocs} onChange={setAcceptedDocs} />
        </div>

        <Button
          onClick={pay}
          disabled={billLines.length === 0 || !consentGiven || busy}
          title={
            billLines.length === 0
              ? t('licensing:store.billEmpty')
              : consentGiven
                ? undefined
                : t('licensing:consent.required')
          }
          className="w-full"
        >
          <ShoppingCart size={16} className="mr-1" />
          {busy
            ? t('licensing:store.paying')
            : t('licensing:store.payTotal', { amount: formatCents(totalCents) })}
        </Button>
      </aside>


      {/* Clears the fixed bar so the last row is never trapped under it. */}
    </div>
  );
};

export default CatalogStore;
