import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LegalDocumentKind,
  useGetCurrentLegalDocument,
} from './legalApi';

/**
 * The three consents Turkish distance selling requires before money moves:
 * KVKK, Mesafeli Satış Sözleşmesi and İade Politikası.
 *
 * The old plan checkout collected these and echoed the document ids to the
 * server, which verified they were the versions currently live and wrote three
 * audit rows. When purchasing moved to the à-la-carte cart the requirement did
 * not move with it, so this component is what puts it back — and it reports
 * the ids up rather than a boolean, because "accepted the terms" is not the
 * same claim as "accepted THESE terms, this version".
 */
const REQUIRED: LegalDocumentKind[] = [
  'KVKK',
  'DISTANCE_SALES',
  'REFUND_POLICY',
];

const DOC_PATH: Record<string, string> = {
  KVKK: '/legal/kvkk',
  DISTANCE_SALES: '/legal/distance-sales',
  REFUND_POLICY: '/legal/refund',
};

export interface CheckoutConsentProps {
  accepted: string[];
  onChange: (ids: string[]) => void;
}

export default function CheckoutConsent({ accepted, onChange }: CheckoutConsentProps) {
  const { t } = useTranslation('licensing');
  const kvkk = useGetCurrentLegalDocument('KVKK');
  const sales = useGetCurrentLegalDocument('DISTANCE_SALES');
  const refund = useGetCurrentLegalDocument('REFUND_POLICY');

  const docs = [kvkk, sales, refund];
  const loading = docs.some((d) => d.isLoading);
  const failed = docs.some((d) => d.isError);

  // If a new version is published while the page is open, the id the buyer
  // ticked is no longer current and the server would reject the checkout.
  // Drop stale ids so the boxes visibly clear instead of failing at payment.
  const currentIds = docs.map((d) => d.data?.id).filter(Boolean) as string[];
  useEffect(() => {
    if (currentIds.length !== REQUIRED.length) return;
    const stale = accepted.filter((id) => !currentIds.includes(id));
    if (stale.length > 0) onChange(accepted.filter((id) => currentIds.includes(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIds.join('|')]);

  if (loading) {
    return <p className="text-sm text-gray-500">{t('consent.loading')}</p>;
  }

  if (failed || currentIds.length !== REQUIRED.length) {
    // Fail closed and say why. Silently hiding the boxes would let the buyer
    // press Pay and hit an opaque 400 from the server's own consent check.
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        {t('consent.unavailable')}
      </p>
    );
  }

  const toggle = (id: string) =>
    onChange(
      accepted.includes(id)
        ? accepted.filter((x) => x !== id)
        : [...accepted, id],
    );

  return (
    <div className="space-y-2">
      {REQUIRED.map((kind, i) => {
        const doc = docs[i].data!;
        return (
          <label key={kind} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={accepted.includes(doc.id)}
              onChange={() => toggle(doc.id)}
            />
            <span className="text-gray-700 dark:text-gray-300">
              <a
                href={DOC_PATH[kind] ?? '/legal'}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                {doc.title}
              </a>{' '}
              {t('consent.suffix')}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** True only when all three current documents are ticked. */
export function useConsentComplete(accepted: string[]): boolean {
  return accepted.length === REQUIRED.length;
}
