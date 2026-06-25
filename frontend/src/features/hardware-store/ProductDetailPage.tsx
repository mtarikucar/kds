import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  useGetProductBySku,
  useRequestQuote,
  formatMoney,
  SALE_MODE_DISCLAIMER_TR,
  type HardwareProduct,
} from './storeApi';
import { useCartStore } from './cartStore';
import { useListBranches } from '../branches/branchesApi';
import { useAuthStore } from '../../store/authStore';
import { prettyKey, prettyValue, localizeDetails } from './productDetailHelpers';
import PhoneInput from '../../components/ui/PhoneInput';

// Mirrors the language resolution that localizeDetails used to do
// internally (document.documentElement.lang with a TR fallback). Kept at
// the call site so the extracted helper stays pure.
function currentDetailsLang(): string {
  return (typeof document !== 'undefined' && document.documentElement.lang) || 'tr';
}

/**
 * v2.8.87 — SPA product / service detail page at /admin/store/:sku.
 *
 * Mirrors the landing detail page in content; differs in two ways:
 *   1. Cart writes go to the shared Zustand `cartStore` so a buyer can
 *      bounce back to the list with their cart intact.
 *   2. Service items require branchId / preferred-dates / notes at
 *      "Add to cart" time — the data flows verbatim into the cart line,
 *      then through quote → checkout → InstallationRequest.
 *
 * Hardware acquisition toggle (Buy / Rent) is rendered only when the
 * product has a rentalMonthlyCents — saves a useless toggle on
 * sale-only SKUs.
 */

const STATUS_LABEL_TR: Record<string, string> = {
  in_stock: 'Stokta',
  preorder: 'Ön sipariş',
  out_of_stock: 'Stokta yok',
  discontinued: 'Üretimden kaldırıldı',
};

// Seller-responsibility compliance docs (TR law) shown on DIRECT_SALE
// products under a "Yasal & Garanti" tab.
const COMPLIANCE_LABELS_TR: Record<string, string> = {
  invoiceIssued: 'Fatura',
  warrantyCertUrl: 'Garanti belgesi',
  distributorName: 'Yetkili distribütör',
  ceConformityUrl: 'CE / uygunluk',
  turkishManualUrl: 'Türkçe kullanım kılavuzu',
  serviceInfo: 'Servis bilgisi',
  returnTermsUrl: 'İade / garanti şartları',
};

export default function ProductDetailPage() {
  const { t } = useTranslation('hardware');
  const { sku } = useParams<{ sku: string }>();
  const navigate = useNavigate();
  const { data: product, isLoading, error } = useGetProductBySku(sku);

  if (isLoading) {
    return <div className="p-6 text-sm text-gray-500">{t('productDetail.loading')}</div>;
  }
  if (error || !product) {
    return (
      <div className="space-y-3 p-6">
        <div className="rounded border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {t('productDetail.notFound')}
        </div>
        <Link to="/admin/store?tab=hardware" className="text-sm text-blue-600 hover:underline">
          {t('productDetail.backToStore')}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <Link to="/admin/store?tab=hardware" className="inline-block text-sm text-blue-600 hover:underline">
        {t('productDetail.backToStore')}
      </Link>

      {product.category === 'service' ? (
        <ServiceDetail product={product} navigate={navigate} />
      ) : (
        <HardwareDetail product={product} navigate={navigate} />
      )}
    </div>
  );
}

function HardwareDetail({
  product,
  navigate,
}: {
  product: HardwareProduct;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const { t } = useTranslation('hardware');
  const addHardware = useCartStore((s) => s.addHardware);
  const [acquisition, setAcquisition] = useState<'sell' | 'rent'>('sell');
  const [activeTab, setActiveTab] = useState<
    'description' | 'specs' | 'compat' | 'requirements' | 'faq' | 'compliance'
  >('description');
  const [zoomed, setZoomed] = useState(false);
  const [brokenSet, setBrokenSet] = useState<Set<number>>(new Set());

  // Regulatory tier (TR law). undefined = DIRECT_SALE (back-compat). Drives
  // which CTA renders; the server-side checkout guard is authoritative.
  const mode = product.saleMode ?? 'DIRECT_SALE';
  const partner = product.partnerRedirect ?? null;
  // Only trust an absolute http(s) URL as a clickable outbound link (guards a
  // stored javascript:/data: payload; the server validates the scheme too).
  const safePartnerUrl =
    partner?.partnerUrl && /^https?:\/\//i.test(partner.partnerUrl)
      ? partner.partnerUrl
      : undefined;
  const complianceEntries = Object.entries(product.complianceDocs ?? {}).filter(
    ([, v]) => v !== null && v !== undefined && v !== '' && v !== false,
  );
  const showCompliance = mode === 'DIRECT_SALE' && complianceEntries.length > 0;

  const isOos = product.stockStatus === 'out_of_stock' || product.stockStatus === 'discontinued';
  // Buy/Rent toggle only makes sense for directly-sellable products.
  const showRental = Boolean(product.rentalMonthlyCents) && mode === 'DIRECT_SALE';
  const showLowStock = (product.available ?? 0) > 0 && (product.available ?? 0) <= 5;

  const details = useMemo(() => localizeDetails(product.details, currentDetailsLang()), [product.details]);

  function fmt(cents: number): string {
    // Shared formatter — one decimals policy across card + detail (cents
    // visible), and currency is non-optional in the product contract.
    return formatMoney(cents, product.currency);
  }

  function add() {
    if (isOos) return;
    addHardware(product, { qty: 1, acquisition });
    toast.success(t('productDetail.addedToCart', { name: product.name }));
    navigate("/admin/store?tab=hardware");
  }

  const showGib = Boolean(
    product.compat && (product.compat as { gibCertified?: boolean }).gibCertified === true,
  );
  const usableImages = product.images.filter((_, i) => !brokenSet.has(i));

  return (
    <>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_400px]">
        <div className="space-y-3">
          {usableImages.length > 0 ? (
            <button
              type="button"
              onClick={() => setZoomed(true)}
              className="block w-full cursor-zoom-in overflow-hidden rounded-xl border bg-white"
              aria-label={t('productDetail.zoomImage')}
            >
              <img
                src={usableImages[0]}
                alt={product.name}
                className="aspect-[4/3] w-full object-cover"
                onError={() => setBrokenSet((s) => new Set([...s, 0]))}
              />
            </button>
          ) : (
            <div className="flex aspect-[4/3] w-full items-center justify-center rounded-xl border border-dashed bg-gray-50 text-sm text-gray-400">
              {t('productDetail.noImage')}
            </div>
          )}
        </div>

        <aside className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {product.brand && (
              <span className="text-xs uppercase tracking-wide text-gray-500">{product.brand}</span>
            )}
            {showGib && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                {t('productDetail.gibCertified')}
              </span>
            )}
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                isOos ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'
              }`}
            >
              {t(`productDetail.stockStatus.${product.stockStatus}`, STATUS_LABEL_TR[product.stockStatus] ?? product.stockStatus)}
            </span>
            {showLowStock && (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-orange-700">
                {t('productDetail.lastUnits', { count: product.available })}
              </span>
            )}
          </div>

          <h1 className="text-2xl font-bold text-gray-900">{product.name}</h1>
          {product.description && <p className="text-sm text-gray-700">{product.description}</p>}

          {showRental && (
            <div className="flex items-center gap-1 rounded-lg border bg-white p-1">
              <button
                type="button"
                onClick={() => setAcquisition('sell')}
                className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  acquisition === 'sell' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t('productDetail.buy')}
              </button>
              <button
                type="button"
                onClick={() => setAcquisition('rent')}
                className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  acquisition === 'rent' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t('productDetail.rent')}
              </button>
            </div>
          )}

          {/* Price / CTA branches by regulatory tier (TR law). */}
          {mode === 'DIRECT_SALE' ? (
            <div className="rounded-xl border bg-gradient-to-br from-slate-50 to-white p-5">
              <div className="text-3xl font-semibold text-gray-900">
                {acquisition === 'rent' && product.rentalMonthlyCents
                  ? t('productDetail.perMonth', { price: fmt(product.rentalMonthlyCents) })
                  : fmt(product.priceCents)}
              </div>
              {acquisition === 'sell' && product.rentalMonthlyCents && (
                <div className="mt-1 text-xs text-gray-500">
                  {t('productDetail.orRentPerMonth', { price: fmt(product.rentalMonthlyCents) })}
                </div>
              )}
              <div className="mt-1 text-xs text-gray-500">{t('productDetail.warranty', { count: product.warrantyMonths })}</div>
              <button
                type="button"
                onClick={add}
                disabled={isOos}
                className="mt-4 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isOos ? t('productDetail.outOfStock') : t('productDetail.addToCart')}
              </button>
            </div>
          ) : mode === 'QUOTE_ONLY' ? (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-5">
              <div className="text-3xl font-semibold text-gray-900">{fmt(product.priceCents)}</div>
              <div className="text-xs text-amber-800">
                {t('productDetail.quoteListPrice')}
              </div>
              <p className="text-sm text-amber-900">
                {SALE_MODE_DISCLAIMER_TR.QUOTE_ONLY} {t('productDetail.quoteGibIncluded')}
              </p>
              <QuoteRequestForm sku={product.sku} />
            </div>
          ) : mode === 'PARTNER_REDIRECT' ? (
            <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50 p-5">
              <p className="text-sm text-indigo-900">
                {SALE_MODE_DISCLAIMER_TR.PARTNER_REDIRECT}
              </p>
              {safePartnerUrl ? (
                <a
                  href={safePartnerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full rounded-md bg-indigo-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-indigo-700"
                >
                  {partner?.partnerName
                    ? t('productDetail.partnerContinueWith', { name: partner.partnerName })
                    : t('productDetail.partnerGoToProvider')}
                </a>
              ) : (
                <p className="text-sm text-indigo-700">
                  {t('productDetail.partnerNoUrl')}
                </p>
              )}
              {partner?.disclaimer && (
                <p className="text-xs text-indigo-700">{partner.disclaimer}</p>
              )}
            </div>
          ) : (
            <div className="space-y-2 rounded-xl border bg-slate-50 p-5">
              <div className="text-3xl font-semibold text-gray-900">{fmt(product.priceCents)}</div>
              <p className="text-sm text-slate-700">
                {t('productDetail.recommendedOnlyBody')}
              </p>
            </div>
          )}
        </aside>
      </div>

      <Tabs
        tabs={[
          { key: 'description', label: t('productDetail.tabs.description') },
          { key: 'specs', label: t('productDetail.tabs.specs') },
          { key: 'compat', label: t('productDetail.tabs.compat') },
          { key: 'requirements', label: t('productDetail.tabs.requirements') },
          { key: 'faq', label: t('productDetail.tabs.faq') },
          ...(showCompliance
            ? [{ key: 'compliance', label: t('productDetail.tabs.compliance') }]
            : []),
        ]}
        active={activeTab}
        onChange={(k) => setActiveTab(k as typeof activeTab)}
      >
        {activeTab === 'description' && (
          <p className="whitespace-pre-line text-sm text-gray-700">
            {product.description || t('productDetail.noDescription')}
          </p>
        )}
        {activeTab === 'specs' && <SpecsBlock specs={product.specs ?? null} />}
        {activeTab === 'compat' && <CompatBlock compat={product.compat ?? null} />}
        {activeTab === 'requirements' && <BulletList items={details.requirements} />}
        {activeTab === 'faq' && <FaqList faq={details.faq} />}
        {activeTab === 'compliance' && <ComplianceBlock entries={complianceEntries} />}
      </Tabs>

      {zoomed && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setZoomed(false)}
          role="dialog"
          aria-modal="true"
        >
          <img
            src={usableImages[0]}
            alt={product.name}
            className="max-h-full max-w-full object-contain"
          />
          <button
            type="button"
            onClick={() => setZoomed(false)}
            className="absolute right-6 top-6 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            aria-label={t('productDetail.close')}
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}

function ServiceDetail({
  product,
  navigate,
}: {
  product: HardwareProduct;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const { t } = useTranslation('hardware');
  const addService = useCartStore((s) => s.addService);
  const { data: branches = [] } = useListBranches();
  const meta = (product.serviceMeta ?? {}) as {
    serviceType?: 'onsite' | 'remote' | 'consultation';
    durationHours?: number;
    geoCoverage?: string[];
    requiresBranch?: boolean;
  };
  const requiresBranch = Boolean(meta.requiresBranch);

  const [branchId, setBranchId] = useState<string>('');
  const [date1, setDate1] = useState('');
  const [date2, setDate2] = useState('');
  const [date3, setDate3] = useState('');
  const [notes, setNotes] = useState('');
  const [activeTab, setActiveTab] = useState<'includes' | 'steps' | 'requirements' | 'faq'>(
    'includes',
  );

  const details = useMemo(() => localizeDetails(product.details, currentDetailsLang()), [product.details]);

  const branchValid = !requiresBranch || Boolean(branchId);

  function fmt(cents: number): string {
    // Shared formatter — one decimals policy across card + detail (cents
    // visible), and currency is non-optional in the product contract.
    return formatMoney(cents, product.currency);
  }

  function add() {
    if (!branchValid) {
      toast.error(t('productDetail.service.selectBranchError'));
      return;
    }
    const preferredDates = [date1, date2, date3].filter(Boolean);
    addService(product, {
      branchId: branchId || undefined,
      preferredDates: preferredDates.length > 0 ? preferredDates : undefined,
      notes: notes.trim() || undefined,
    });
    toast.success(t('productDetail.addedToCart', { name: product.name }));
    navigate("/admin/store?tab=hardware");
  }

  const serviceTypeLabel =
    meta.serviceType === 'remote'
      ? t('productDetail.service.remote')
      : meta.serviceType === 'consultation'
        ? t('productDetail.service.consultation')
        : t('productDetail.service.onsite');

  return (
    <>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_400px]">
        <div className="rounded-2xl border bg-gradient-to-br from-blue-50/50 to-white p-6">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-blue-700">
              {serviceTypeLabel}
            </span>
            {meta.durationHours && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                {t('productDetail.service.hours', { count: meta.durationHours })}
              </span>
            )}
            {requiresBranch && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                {t('productDetail.service.branchRequired')}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{product.name}</h1>
          {product.description && <p className="mt-3 text-gray-700">{product.description}</p>}
          {meta.geoCoverage && meta.geoCoverage.length > 0 && (
            <div className="mt-4 rounded-lg bg-white/70 p-3 text-sm">
              <span className="font-medium text-gray-700">{t('productDetail.service.serviceAreas')}</span>{' '}
              <span className="text-gray-600">{meta.geoCoverage.join(', ')}</span>
            </div>
          )}
        </div>

        <aside className="space-y-3">
          <div className="rounded-xl border bg-white p-5">
            <div className="text-3xl font-semibold text-gray-900">{fmt(product.priceCents)}</div>
            <div className="mt-1 text-xs text-gray-500">{t('productDetail.service.oneTimeExclVat')}</div>

            {requiresBranch && (
              <div className="mt-4">
                <label className="block text-xs font-medium text-gray-700">
                  {t('productDetail.service.branch')} <span className="text-rose-600">*</span>
                </label>
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                >
                  <option value="">{t('productDetail.service.selectBranch')}</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {meta.serviceType === 'onsite' && (
              <div className="mt-4 space-y-2">
                <div className="text-xs font-medium text-gray-700">{t('productDetail.service.preferredDates')}</div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="date"
                    value={date1}
                    onChange={(e) => setDate1(e.target.value)}
                    className="rounded border px-2 py-1.5 text-xs"
                  />
                  <input
                    type="date"
                    value={date2}
                    onChange={(e) => setDate2(e.target.value)}
                    className="rounded border px-2 py-1.5 text-xs"
                  />
                  <input
                    type="date"
                    value={date3}
                    onChange={(e) => setDate3(e.target.value)}
                    className="rounded border px-2 py-1.5 text-xs"
                  />
                </div>
                <p className="text-[11px] text-gray-500">
                  {t('productDetail.service.preferredDatesNote')}
                </p>
              </div>
            )}

            <div className="mt-4">
              <label className="block text-xs font-medium text-gray-700">{t('productDetail.service.note')}</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder={t('productDetail.service.notePlaceholder')}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </div>

            <button
              type="button"
              onClick={add}
              disabled={!branchValid}
              className="mt-4 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('productDetail.service.addToCart')}
            </button>
          </div>
        </aside>
      </div>

      <Tabs
        tabs={[
          { key: 'includes', label: t('productDetail.service.tabs.includes') },
          { key: 'steps', label: t('productDetail.service.tabs.steps') },
          { key: 'requirements', label: t('productDetail.service.tabs.requirements') },
          { key: 'faq', label: t('productDetail.service.tabs.faq') },
        ]}
        active={activeTab}
        onChange={(k) => setActiveTab(k as typeof activeTab)}
      >
        {activeTab === 'includes' && <BulletList items={details.includes} />}
        {activeTab === 'steps' && <StepsList steps={details.steps} />}
        {activeTab === 'requirements' && <BulletList items={details.requirements} />}
        {activeTab === 'faq' && <FaqList faq={details.faq} />}
      </Tabs>
    </>
  );
}

// -- shared sub-components ----------------------------------------------

function Tabs({
  tabs,
  active,
  onChange,
  children,
}: {
  tabs: { key: string; label: string }[];
  active: string;
  onChange: (k: string) => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation('hardware');
  return (
    <section>
      <div className="border-b">
        <nav className="-mb-px flex flex-wrap gap-1" aria-label={t('productDetail.tabs.tabsAria')}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onChange(tab.key)}
              className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                active === tab.key
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="py-6">{children}</div>
    </section>
  );
}

function BulletList({ items }: { items?: string[] }) {
  const { t } = useTranslation('hardware');
  if (!items || items.length === 0) {
    return <p className="text-sm text-gray-500">{t('productDetail.notEnteredYet')}</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((s, i) => (
        <li key={i} className="flex items-start gap-3">
          <span aria-hidden className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
          <span className="text-sm text-gray-700">{s}</span>
        </li>
      ))}
    </ul>
  );
}

function StepsList({ steps }: { steps?: { title: string; body: string }[] }) {
  const { t } = useTranslation('hardware');
  if (!steps || steps.length === 0) {
    return <p className="text-sm text-gray-500">{t('productDetail.notEnteredYet')}</p>;
  }
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={i} className="rounded-lg border bg-slate-50 p-4">
          <div className="text-sm font-semibold text-gray-900">{s.title}</div>
          <div className="mt-1 text-sm text-gray-600">{s.body}</div>
        </li>
      ))}
    </ol>
  );
}

function FaqList({ faq }: { faq?: { q: string; a: string }[] }) {
  const { t } = useTranslation('hardware');
  if (!faq || faq.length === 0) {
    return <p className="text-sm text-gray-500">{t('productDetail.notEnteredYet')}</p>;
  }
  return (
    <div className="space-y-3">
      {faq.map((item, i) => (
        <details key={i} className="rounded-lg border bg-white px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-gray-900">{item.q}</summary>
          <p className="mt-2 text-sm text-gray-600">{item.a}</p>
        </details>
      ))}
    </div>
  );
}

function SpecsBlock({ specs }: { specs: Record<string, unknown> | null }) {
  const { t } = useTranslation('hardware');
  if (!specs) return <p className="text-sm text-gray-500">{t('productDetail.noSpecs')}</p>;
  const entries = Object.entries(specs).filter(([k]) => k !== 'headlineSpecs');
  if (entries.length === 0) return <p className="text-sm text-gray-500">{t('productDetail.noSpecs')}</p>;
  return (
    <dl className="divide-y rounded-lg border">
      {entries.map(([k, v]) => (
        <div key={k} className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[200px_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-gray-500">{prettyKey(k)}</dt>
          <dd className="text-sm text-gray-900">{prettyValue(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function CompatBlock({ compat }: { compat: Record<string, unknown> | null }) {
  const { t } = useTranslation('hardware');
  if (!compat) return <p className="text-sm text-gray-500">{t('productDetail.noCompat')}</p>;
  const entries = Object.entries(compat).filter(([k]) => k !== 'gibCertified' && k !== 'sourceUrl');
  if (entries.length === 0) return <p className="text-sm text-gray-500">{t('productDetail.noCompat')}</p>;
  return (
    <dl className="space-y-3">
      {entries.map(([k, v]) => (
        <div key={k} className="rounded-lg border p-4">
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{k}</dt>
          <dd className="mt-1 text-sm text-gray-900">{prettyValue(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

// "Teklif Al" form for a QUOTE_ONLY device (yazarkasa / YN ÖKC). Posts to the
// catalog quote-request endpoint, which records a marketing Lead
// (source=HARDWARE_QUOTE) for a rep to run the dealer/installation + GİB
// process. Prefills from the signed-in tenant user.
function QuoteRequestForm({ sku }: { sku: string }) {
  const { t } = useTranslation('hardware');
  const user = useAuthStore((s) => s.user);
  const requestQuote = useRequestQuote();
  const [done, setDone] = useState(false);
  const [contactPerson, setContactPerson] = useState(
    user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() : '',
  );
  const [phone, setPhone] = useState<string>((user as any)?.phone ?? '');
  const [email, setEmail] = useState<string>(user?.email ?? '');
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');

  if (done) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
        {t('productDetail.quoteForm.done')}
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!contactPerson.trim()) {
      toast.error(t('productDetail.quoteForm.contactPersonRequired'));
      return;
    }
    await requestQuote.mutateAsync({
      sku,
      qty,
      contactPerson: contactPerson.trim(),
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    setDone(true);
    toast.success(t('productDetail.quoteForm.sent'));
  }

  const inputCls = 'w-full rounded border px-2 py-1.5 text-sm';
  return (
    <form onSubmit={submit} className="space-y-2">
      <input
        className={inputCls}
        placeholder={t('productDetail.quoteForm.contactPerson')}
        value={contactPerson}
        onChange={(e) => setContactPerson(e.target.value)}
        maxLength={120}
        required
      />
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <PhoneInput
            value={phone}
            onChange={setPhone}
            placeholder={t('productDetail.quoteForm.phone')}
            defaultCountry="TR"
          />
        </div>
        <input
          className="w-20 rounded border px-2 py-1.5 text-sm"
          type="number"
          min={1}
          max={999}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Math.min(999, Number(e.target.value) || 1)))}
          aria-label={t('productDetail.quoteForm.qtyAria')}
        />
      </div>
      <input
        className={inputCls}
        type="email"
        placeholder={t('productDetail.quoteForm.email')}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        maxLength={200}
      />
      <textarea
        className={inputCls}
        placeholder={t('productDetail.quoteForm.notePlaceholder')}
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={2000}
      />
      <button
        type="submit"
        disabled={requestQuote.isPending}
        className="w-full rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {requestQuote.isPending ? t('productDetail.quoteForm.sending') : t('productDetail.quoteForm.getQuote')}
      </button>
    </form>
  );
}

// Seller-responsibility compliance docs (Tier 3 / DIRECT_SALE). Renders URL
// values as links, boolean true as a check, everything else as text.
function ComplianceBlock({ entries }: { entries: [string, unknown][] }) {
  const { t } = useTranslation('hardware');
  if (!entries.length) {
    return <p className="text-sm text-gray-500">{t('productDetail.noDocs')}</p>;
  }
  return (
    <dl className="divide-y rounded-lg border">
      {entries.map(([k, v]) => (
        <div
          key={k}
          className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[220px_1fr] sm:gap-4"
        >
          <dt className="text-sm font-medium text-gray-500">
            {COMPLIANCE_LABELS_TR[k] ?? prettyKey(k)}
          </dt>
          <dd className="text-sm text-gray-900">
            {typeof v === 'string' && /^(https?:\/\/|\/)/.test(v) ? (
              <a href={v} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                {t('productDetail.viewDocument')}
              </a>
            ) : v === true ? (
              t('productDetail.present')
            ) : (
              String(v)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
