import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Boxes } from 'lucide-react';
import { useFormatCurrencyExtended } from '../../hooks/useFormatCurrency';
import { useGetPrint3dOffer } from './print3dApi';
import PartnerBadge from './PartnerBadge';

/**
 * Mağazadaki TEK 3D baskı kartı.
 *
 * İki ham SKU (print3d_base / print3d_item) hizmet ızgarasından filtrelenir;
 * alıcı tek bir kart görür ve sihirbaza gider. Teklif available:false dönerse
 * (katalog satırı yayında değil / DIRECT_SALE değil) kart HİÇ basılmaz.
 *
 * Fiyat SUNUCUDAN gelir (Görev 8 `getOffer()`), i18n'deki `card.price`
 * statik teaser metni burada KULLANILMAZ — o metin ₺1.500/₺50'yi elle
 * gömdüğü için sunucu otoritesini ekranda geçersiz kılardı. Bunun yerine
 * `card.priceLine` bir ŞABLONDUR ({{base}} / {{perItem}}); rakamlar her
 * zaman offer.basePriceCents / offer.perItemCents'ten türer.
 */
export default function Print3dStoreCard() {
  const { t } = useTranslation('hardware');
  const { data: offer } = useGetPrint3dOffer();
  const { formatWithCurrency } = useFormatCurrencyExtended();
  if (!offer?.available) return null;

  return (
    <article
      data-testid="print3d-store-card"
      className="overflow-hidden rounded-lg border bg-gradient-to-br from-violet-50/60 to-white"
    >
      <div className="p-4">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Boxes className="h-4 w-4 text-violet-600" aria-hidden="true" />
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
            {t('print3d.card.title')}
          </span>
        </div>
        <h3 className="mt-1 font-semibold">{t('print3d.card.title')}</h3>
        <p className="mt-1 text-sm text-gray-600">{t('print3d.card.desc')}</p>
        <p className="mt-2 text-sm font-medium">
          {t('print3d.card.priceLine', {
            base: formatWithCurrency(offer.basePriceCents / 100, offer.currency),
            perItem: formatWithCurrency(offer.perItemCents / 100, offer.currency),
          })}
        </p>
        <div className="mt-3 flex items-center justify-between">
          <PartnerBadge url={offer.partnerUrl} />
          <Link
            to="/admin/store/print3d"
            className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700"
          >
            {t('print3d.card.cta')}
          </Link>
        </div>
      </div>
    </article>
  );
}
