import { useTranslation } from 'react-i18next';
import { Check, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AutoSaveStatus } from '../../hooks/useAutoSave';

interface SaveStatusIndicatorProps {
  status: AutoSaveStatus;
  onRetry?: () => void;
  className?: string;
  showIdle?: boolean;
}

export function SaveStatusIndicator({
  status,
  onRetry,
  className,
  showIdle = false,
}: SaveStatusIndicatorProps) {
  const { t } = useTranslation('settings');

  if (status === 'idle' && !showIdle) {
    return null;
  }

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 text-sm transition-all duration-200',
        {
          'text-slate-400': status === 'idle',
          'text-primary-500': status === 'saving',
          'text-green-600': status === 'saved',
          'text-red-500': status === 'error',
        },
        className
      )}
    >
      {status === 'idle' && showIdle && (
        <>
          <div className="w-1.5 h-1.5 rounded-full bg-slate-300" />
          <span className="text-slate-400">{t('autoSave.idle')}</span>
        </>
      )}

      {status === 'saving' && (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>{t('autoSave.saving')}</span>
        </>
      )}

      {status === 'saved' && (
        <>
          <Check className="w-3.5 h-3.5" />
          <span>{t('autoSave.saved')}</span>
        </>
      )}

      {status === 'error' && (
        <>
          <AlertCircle className="w-3.5 h-3.5" />
          <span>{t('autoSave.error')}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="ml-1 inline-flex items-center gap-1 text-red-600 hover:text-red-700 underline underline-offset-2"
            >
              <RefreshCw className="w-3 h-3" />
              {t('autoSave.retry')}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default SaveStatusIndicator;
