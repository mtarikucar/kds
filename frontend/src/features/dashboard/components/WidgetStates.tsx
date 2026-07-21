import { useTranslation } from 'react-i18next';

// Per-widget soft failure: one muted line inside the card, never a page break.
export const WidgetError = () => {
  const { t } = useTranslation('common');
  return (
    <p data-testid="widget-error" className="text-xs text-slate-400 py-2">
      {t('dashboard.widgetError')}
    </p>
  );
};

export const WidgetEmpty = ({ text }: { text: string }) => (
  <p data-testid="widget-empty" className="text-sm text-slate-400 py-2">
    {text}
  </p>
);
