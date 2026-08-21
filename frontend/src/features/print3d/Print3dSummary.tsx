import { useTranslation } from 'react-i18next';
import CheckoutConsent, { useConsentComplete } from '../legal/CheckoutConsent';
import { useFormatCurrencyExtended } from '../../hooks/useFormatCurrency';
import { computePrint3dTotalCents } from './print3dSkus';
import PartnerBadge from './PartnerBadge';

/**
 * Sihirbaz adım 3 — satır dökümü, yasal onam, ödeme.
 *
 * ÜÇ KAPI, üçü de Öde düğmesini kilitler:
 *   1. üç sözleşme işaretlenmeden ödeme yok;
 *   2. sunucudan gerçek toplam gelmeden ödeme yok (istemci aritmetiği
 *      yalnızca önizlemedir);
 *   3. sunucu toplamı yerel hesapla ayrışıyorsa ödeme yok — böyle bir
 *      ayrışma katalog fiyatının değiştiği anlamına gelir ve alıcıya
 *      gösterilen tutardan farklı bir tutar çekilmemelidir.
 *
 * Toplam satırı DAİMA `serverTotalCents ?? localTotal` gösterir — sunucu
 * yanıtı geldiyse (ayrışsa BİLE) ekranda görünen rakam odur, asla yerel
 * hesabın kendisi değil. Böylece "ödeme kilitli ama ekranda hangi tutar
 * yazıyor" sorusunun cevabı her zaman "sunucunun söylediği" olur.
 *
 * Para formatlama: storeApi'nin sabit tr-TR `formatMoney`'i YERİNE
 * `useFormatCurrencyExtended` (ülke-profili sürücülü) kullanılıyor —
 * v3.7.0 money/date gösterimini ülke profiline bağladı ve Görev 14/15/16
 * aynı düzeltmeyi Print3dStoreCard / Print3dProductPicker'da zaten yapmak
 * zorunda kalmıştı.
 */
export default function Print3dSummary({
  itemCount,
  basePriceCents,
  perItemCents,
  currency,
  partnerUrl,
  accepted,
  onAcceptedChange,
  serverTotalCents,
  verifying,
  onPay,
  paying,
}: {
  itemCount: number;
  basePriceCents: number;
  perItemCents: number;
  currency: string;
  partnerUrl: string | null;
  accepted: string[];
  onAcceptedChange: (ids: string[]) => void;
  serverTotalCents: number | null;
  verifying: boolean;
  onPay: () => void;
  paying: boolean;
}) {
  const { t } = useTranslation('hardware');
  const { formatWithCurrency } = useFormatCurrencyExtended();
  const consentGiven = useConsentComplete(accepted);
  const localTotal = computePrint3dTotalCents(
    itemCount,
    basePriceCents,
    perItemCents,
  );
  const mismatch = serverTotalCents !== null && serverTotalCents !== localTotal;
  const canPay =
    consentGiven && !verifying && !paying && serverTotalCents !== null && !mismatch;

  return (
    <div className="space-y-4">
      <PartnerBadge url={partnerUrl} />

      <div className="space-y-1 rounded border bg-white p-4 text-sm">
        <Row
          testId="print3d-line-base"
          label={t('print3d.summary.baseLine')}
          value={formatWithCurrency(basePriceCents / 100, currency)}
        />
        <Row
          testId="print3d-line-items"
          label={t('print3d.summary.itemLine', { count: itemCount })}
          value={formatWithCurrency((perItemCents * itemCount) / 100, currency)}
        />
        {/* Kargo BİLEREK 0: hizmet-yalnız sepette QuoteService kargo eklemez
            ve ilan edilen fiyat "kargo dahil". Satırı gizlemek alıcıyı
            "kargo sonra eklenecek mi?" sorusuyla bırakırdı. */}
        <Row
          testId="print3d-line-shipping"
          label={t('print3d.summary.shipping')}
          value={formatWithCurrency(0, currency)}
        />
        <div className="mt-2 border-t pt-2">
          <Row
            testId="print3d-total"
            label={t('print3d.summary.total')}
            value={formatWithCurrency((serverTotalCents ?? localTotal) / 100, currency)}
            bold
          />
        </div>
      </div>

      {verifying && (
        <p className="text-xs text-gray-500">{t('print3d.summary.verifying')}</p>
      )}
      {mismatch && (
        <p className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {t('print3d.summary.mismatch')}
        </p>
      )}

      <div className="border-t pt-3">
        <h3 className="mb-2 text-xs font-semibold text-gray-900">
          {t('print3d.summary.consentTitle')}
        </h3>
        <CheckoutConsent accepted={accepted} onChange={onAcceptedChange} />
        {!consentGiven && (
          <p className="mt-2 text-xs text-amber-700">
            {t('print3d.summary.consentRequired')}
          </p>
        )}
      </div>

      <button
        type="button"
        disabled={!canPay}
        onClick={() => canPay && onPay()}
        className="w-full rounded bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t('print3d.summary.pay')}
      </button>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  testId,
}: {
  label: string;
  value: string;
  bold?: boolean;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className={`flex items-center justify-between ${bold ? 'font-semibold' : ''}`}
    >
      <span className="text-gray-600">{label}</span>
      <span>{value}</span>
    </div>
  );
}
