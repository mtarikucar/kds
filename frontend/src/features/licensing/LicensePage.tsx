import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CalendarClock,
  Coins,
  FileText,
  Package,
  ShieldCheck,
  ShoppingCart,
} from 'lucide-react';
import { useEntitlements } from '../../contexts/SubscriptionContext';
import {
  formatCents,
  OwnedProduct,
  useTenantInvoices,
} from './licensingApi';
import Button from '../../components/ui/Button';

/**
 * "Lisans & Erişim" — what the tenant owns, when it renews, and what it costs.
 *
 * Replaces the plan page. The shape of the information changed completely:
 * there is no tier to compare against and no upgrade path, only a licence
 * with an anniversary and a list of individually-owned products. The page's
 * job is to answer three questions without the customer having to ask
 * support: what do I have, when do I pay again, and how much.
 */
const STATUS_TONE: Record<string, string> = {
  active: 'text-emerald-600 dark:text-emerald-400',
  grace: 'text-amber-600 dark:text-amber-400',
  expired: 'text-red-600 dark:text-red-400',
  none: 'text-gray-500 dark:text-gray-400',
};

function OwnedRow({ item }: { item: OwnedProduct }) {
  const { t } = useTranslation('licensing');
  const lapsed = item.status !== 'active';
  return (
    <tr className="border-b border-gray-100 last:border-0 dark:border-gray-800">
      <td className="py-3 pr-4">
        <div className="font-medium text-gray-900 dark:text-gray-100">
          {item.name}
          {item.quantity > 1 && (
            <span className="ml-1 text-gray-500">×{item.quantity}</span>
          )}
        </div>
        {item.origin === 'comp' && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            {t('owned.comped')}
          </span>
        )}
        {item.pendingQuantity != null &&
          item.pendingQuantity !== item.quantity && (
            <div className="text-xs text-amber-600 dark:text-amber-400">
              {t('owned.pendingQuantity', { qty: item.pendingQuantity })}
            </div>
          )}
      </td>
      <td className="py-3 pr-4 text-sm text-gray-600 dark:text-gray-400">
        {item.periodEnd
          ? new Date(item.periodEnd).toLocaleDateString('tr-TR')
          : '—'}
      </td>
      <td className="py-3 pr-4 text-sm">
        {lapsed ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            {t(`owned.status.${item.status}`)}
          </span>
        ) : (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            {t('owned.status.active')}
          </span>
        )}
      </td>
      <td className="py-3 text-right text-sm text-gray-900 dark:text-gray-100">
        {formatCents(item.renewalCents, item.currency)}
        <span className="ml-1 text-xs text-gray-500">{t('owned.perYear')}</span>
      </td>
    </tr>
  );
}

const LicensePage = () => {
  const { t } = useTranslation(['licensing', 'common']);
  const navigate = useNavigate();
  const { license, owned, credits, renewal, isLoading } = useEntitlements();
  const { data: invoices = [] } = useTenantInvoices();

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-gray-500">{t('common:loading')}</div>
    );
  }

  const creditRows = Object.entries(credits).filter(([, v]) => v > 0);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          {t('licensing:page.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('licensing:page.subtitle')}
        </p>
      </header>

      {/* The renewal banner comes first when one is open: it is the only
          thing on this page with a deadline attached. */}
      {renewal && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <CalendarClock className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" size={20} />
            <div>
              <p className="font-medium text-amber-900 dark:text-amber-200">
                {t('licensing:renewal.title', {
                  date: new Date(renewal.anniversaryAt).toLocaleDateString('tr-TR'),
                })}
              </p>
              <p className="text-sm text-amber-800 dark:text-amber-300">
                {t('licensing:renewal.body', {
                  total: formatCents(renewal.totalCents, renewal.currency),
                  days: renewal.daysLeft,
                })}
              </p>
            </div>
          </div>
          <Button onClick={() => navigate(`/admin/license/renewal/${renewal.cycleId}`)}>
            {t('licensing:renewal.cta')}
          </Button>
        </div>
      )}

      {/* Licence */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            {license.status === 'active' ? (
              <ShieldCheck className="mt-0.5 text-emerald-600 dark:text-emerald-400" size={22} />
            ) : (
              <AlertTriangle className="mt-0.5 text-amber-600 dark:text-amber-400" size={22} />
            )}
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                {t('licensing:license.heading')}
              </h2>
              <p className={`text-sm font-medium ${STATUS_TONE[license.status]}`}>
                {t(`licensing:license.status.${license.status}`)}
              </p>
              {license.anniversaryAt && (
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  {t('licensing:license.anniversary', {
                    date: new Date(license.anniversaryAt).toLocaleDateString('tr-TR'),
                    days: license.daysRemaining ?? 0,
                  })}
                </p>
              )}
            </div>
          </div>
          {license.status !== 'active' && (
            <Button onClick={() => navigate('/admin/store?tab=catalog')}>
              <ShoppingCart size={16} className="mr-1" />
              {license.status === 'expired'
                ? t('licensing:license.renewCta')
                : t('licensing:license.buyCta')}
            </Button>
          )}
        </div>

        {/* The free core is stated explicitly. Without it the page reads as
            "you have nothing", when in fact the whole POS is running. */}
        <p className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-800/60 dark:text-gray-400">
          {t('licensing:license.freeCoreNote')}
        </p>
      </section>

      {/* Owned products */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-3 flex items-center gap-2">
          <Package size={18} className="text-gray-500" />
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">
            {t('licensing:owned.title')}
          </h2>
        </div>
        {owned.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('licensing:owned.empty')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700">
                  <th className="pb-2 pr-4 font-medium">{t('licensing:owned.col.product')}</th>
                  <th className="pb-2 pr-4 font-medium">{t('licensing:owned.col.until')}</th>
                  <th className="pb-2 pr-4 font-medium">{t('licensing:owned.col.status')}</th>
                  <th className="pb-2 text-right font-medium">
                    {t('licensing:owned.col.renewal')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {owned.map((item) => (
                  <OwnedRow key={`${item.code}-${item.periodEnd ?? ''}`} item={item} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Credits */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-3 flex items-center gap-2">
          <Coins size={18} className="text-gray-500" />
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">
            {t('licensing:credits.title')}
          </h2>
        </div>
        {creditRows.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('licensing:credits.empty')}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {creditRows.map(([kind, remaining]) => (
              <div
                key={kind}
                className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
              >
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  {t(`licensing:credits.kind.${kind}`)}
                </div>
                <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                  {remaining}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-gray-500">{t('licensing:credits.note')}</p>
      </section>

      {/* Invoices. A customer who has paid must be able to see what for —
          the à-la-carte invoice is itemized, so this links to the detail
          rather than restating a single total. */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-3 flex items-center gap-2">
          <FileText size={18} className="text-gray-500" />
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">
            {t('licensing:invoices.title')}
          </h2>
        </div>
        {invoices.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('licensing:invoices.empty')}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {invoices.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div>
                  <div className="font-mono text-sm text-gray-900 dark:text-gray-100">
                    {inv.invoiceNumber}
                  </div>
                  <div className="text-xs text-gray-500">
                    {new Date(inv.issuedAt).toLocaleDateString('tr-TR')} ·{' '}
                    {t('licensing:invoices.lineCount', {
                      count: inv.lines.length,
                    })}
                  </div>
                </div>
                <div className="text-right text-sm font-medium text-gray-900 dark:text-gray-100">
                  {formatCents(inv.totalCents, inv.currency)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default LicensePage;
