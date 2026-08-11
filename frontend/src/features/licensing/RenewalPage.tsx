import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarClock, ArrowLeft } from 'lucide-react';
import { useEntitlements } from '../../contexts/SubscriptionContext';
import { formatCents } from './licensingApi';
import { usePurchaseAddOnViaCheckout } from '../marketplace/marketplaceApi';
import CheckoutConsent, { useConsentComplete } from '../legal/CheckoutConsent';
import Button from '../../components/ui/Button';

/**
 * The annual renewal, itemized.
 *
 * The whole point of the anniversary model is that a customer pays once a
 * year and sees exactly what for, so this page is a line-by-line bill rather
 * than a total with a Pay button. Lines are priced at full annual list — a
 * renewal covers a whole cycle, unlike the prorated slice a mid-year purchase
 * costs — and the totals come from the frozen quote, so what is shown here is
 * what the reminder email said and what the card will be charged.
 */
const RenewalPage = () => {
  const { t } = useTranslation(['licensing', 'common']);
  const navigate = useNavigate();
  const { cycleId } = useParams<{ cycleId: string }>();
  const { renewal, owned, isLoading } = useEntitlements();
  const purchase = usePurchaseAddOnViaCheckout();
  const [acceptedDocs, setAcceptedDocs] = useState<string[]>([]);
  const consentGiven = useConsentComplete(acceptedDocs);

  if (isLoading) {
    return <div className="p-6 text-sm text-gray-500">{t('common:loading')}</div>;
  }

  if (!renewal || renewal.cycleId !== cycleId) {
    return (
      <div className="space-y-4 p-6">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('licensing:renewal.notFound')}
        </p>
        <Button variant="secondary" onClick={() => navigate('/admin/license')}>
          <ArrowLeft size={16} className="mr-1" />
          {t('licensing:renewal.backToLicense')}
        </Button>
      </div>
    );
  }

  // Renewable = everything the licence page lists as owned and annual. The
  // authoritative list lives on the frozen cycle server-side; this mirrors it
  // for display and sends only codes, so a tampered client cannot change what
  // is billed.
  const lines = owned.filter((o) => o.renewalCents > 0);

  const pay = () =>
    purchase.mutate({
      items: lines.map((l) => ({
        type: 'addon' as const,
        code: l.code,
        qty: l.quantity,
      })),
      acceptedDocumentIds: acceptedDocs,
    });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <button
        onClick={() => navigate('/admin/license')}
        className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400"
      >
        <ArrowLeft size={16} />
        {t('licensing:renewal.backToLicense')}
      </button>

      <header className="flex items-start gap-3">
        <CalendarClock className="mt-1 text-amber-600 dark:text-amber-400" size={22} />
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
            {t('licensing:renewal.title', {
              date: new Date(renewal.anniversaryAt).toLocaleDateString('tr-TR'),
            })}
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('licensing:renewal.graceNote', {
              date: new Date(renewal.graceEndsAt).toLocaleDateString('tr-TR'),
            })}
          </p>
        </div>
      </header>

      <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700">
              <th className="p-4 font-medium">{t('licensing:owned.col.product')}</th>
              <th className="p-4 text-right font-medium">
                {t('licensing:owned.col.renewal')}
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr
                key={l.code}
                className="border-b border-gray-100 last:border-0 dark:border-gray-800"
              >
                <td className="p-4">
                  {l.name}
                  {l.quantity > 1 && (
                    <span className="ml-1 text-gray-500">×{l.quantity}</span>
                  )}
                </td>
                <td className="p-4 text-right">
                  {formatCents(l.renewalCents, l.currency)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-200 font-semibold dark:border-gray-700">
              <td className="p-4">{t('licensing:renewal.total')}</td>
              <td className="p-4 text-right">
                {formatCents(renewal.totalCents, renewal.currency)}
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t('licensing:consent.title')}
        </h2>
        <CheckoutConsent accepted={acceptedDocs} onChange={setAcceptedDocs} />
      </section>

      <Button
        onClick={pay}
        disabled={purchase.isPending || !consentGiven}
        title={consentGiven ? undefined : t('licensing:consent.required')}
        className="w-full"
      >
        {t('licensing:renewal.payCta', {
          total: formatCents(renewal.totalCents, renewal.currency),
        })}
      </Button>
    </div>
  );
};

export default RenewalPage;
