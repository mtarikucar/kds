import { useTranslation } from 'react-i18next';
import { CheckCircle, XCircle, AlertTriangle, Loader2, Settings2 } from 'lucide-react';

interface PlatformStatusBadgeProps {
  isEnabled: boolean;
  errorCount: number;
  lastError?: string | null;
  isConnecting?: boolean;
  hasCredentials?: boolean;
}

const PlatformStatusBadge = ({
  isEnabled,
  errorCount,
  lastError,
  isConnecting,
  hasCredentials = false,
}: PlatformStatusBadgeProps) => {
  const { t } = useTranslation('settings');

  if (isConnecting) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('onlineOrders.status.connecting')}
      </span>
    );
  }

  if (!isEnabled && !hasCredentials) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-500">
        <Settings2 className="h-3 w-3" />
        {t('onlineOrders.status.notConfigured')}
      </span>
    );
  }

  if (!isEnabled) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
        <XCircle className="h-3 w-3" />
        {t('onlineOrders.status.disabled')}
      </span>
    );
  }

  if (!hasCredentials) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
        <Settings2 className="h-3 w-3" />
        {t('onlineOrders.status.missingCredentials')}
      </span>
    );
  }

  if (errorCount >= 10) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700" title={lastError || undefined}>
        <XCircle className="h-3 w-3" />
        {t('onlineOrders.status.circuitOpen')}
      </span>
    );
  }

  if (errorCount > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700" title={lastError || undefined}>
        <AlertTriangle className="h-3 w-3" />
        {t('onlineOrders.status.errors', { count: errorCount })}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
      <CheckCircle className="h-3 w-3" />
      {t('onlineOrders.status.connected')}
    </span>
  );
};

export default PlatformStatusBadge;
