import { useTranslation } from 'react-i18next';
import { safePartnerUrl } from './partnerUrl';

/**
 * "Üretim ortağı: Figurunica".
 *
 * Metin HİÇBİR KOŞULDA boş değildir — bu bir beyandır, bağlantıya bağlı
 * değildir. URL geçerliyse <a>, değilse düz <span>. `null` dalı normalde
 * yalnızca PRINT3D_PARTNER_URL hatalı bir değerle ezildiğinde görülür.
 */
export default function PartnerBadge({
  url,
  className,
}: {
  url: string | null;
  className?: string;
}) {
  const { t } = useTranslation('hardware');
  const label = t('print3d.partnerLabel');
  const href = safePartnerUrl(url);
  const cls = `text-xs text-gray-500 ${className ?? ''}`.trim();

  if (!href) {
    return <span className={cls}>{label}</span>;
  }
  return (
    <a
      className={`${cls} underline underline-offset-2`}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {label}
    </a>
  );
}
