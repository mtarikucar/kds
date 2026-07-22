// frontend/src/pages/admin/stock/GuidanceTab.tsx  (Phase 2 replaces the body)
import { useTranslation } from 'react-i18next';
export default function GuidanceTab() {
  const { t } = useTranslation('stock');
  return <div data-testid="guidance-tab">{t('nav.guide')}</div>;
}
