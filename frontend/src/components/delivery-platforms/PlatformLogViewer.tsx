import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { useDeliveryPlatformLogs } from '../../features/delivery-platforms/deliveryPlatformsApi';
import type { DeliveryPlatformLog } from '../../types';

const PAGE_SIZE = 30;

interface PlatformLogViewerProps {
  platform?: string;
}

const PlatformLogViewer = ({ platform }: PlatformLogViewerProps) => {
  const { t, i18n } = useTranslation('settings');
  const [filter, setFilter] = useState<'all' | 'success' | 'failed'>('all');
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useDeliveryPlatformLogs({
    platform: platform?.toUpperCase(),
    success: filter === 'all' ? undefined : filter === 'success',
    limit: PAGE_SIZE,
    offset,
  });

  const logs = data?.logs || [];
  const total = data?.total || 0;

  const handleFilterChange = (f: 'all' | 'success' | 'failed') => {
    setFilter(f);
    setOffset(0);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString(i18n.language, {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const filterLabels: Record<string, string> = {
    all: t('onlineOrders.logs.all'),
    success: t('onlineOrders.logs.success'),
    failed: t('onlineOrders.logs.failed'),
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(['all', 'success', 'failed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => handleFilterChange(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                filter === f
                  ? 'bg-primary-100 text-primary-700'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {filterLabels[f]}
            </button>
          ))}
        </div>
        <button
          onClick={() => refetch()}
          className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-slate-400 text-sm">{t('onlineOrders.logs.loadingLogs')}</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-8 text-slate-400 text-sm">{t('onlineOrders.logs.noEntries')}</div>
      ) : (
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {logs.map((log: DeliveryPlatformLog) => (
            <div
              key={log.id}
              className="border border-slate-200 rounded-lg overflow-hidden"
            >
              <button
                onClick={() =>
                  setExpandedId(expandedId === log.id ? null : log.id)
                }
                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {log.success ? (
                    <CheckCircle className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                  )}
                  <span className="text-xs font-medium text-slate-700 truncate">
                    {log.action}
                  </span>
                  <span className="text-xs text-slate-400">
                    {log.direction === 'INBOUND' ? '\u2190' : '\u2192'}
                  </span>
                  {log.externalId && (
                    <span className="text-xs text-slate-400 truncate">
                      {log.externalId.substring(0, 12)}...
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-slate-400">
                    {formatDate(log.createdAt)}
                  </span>
                  {expandedId === log.id ? (
                    <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                  )}
                </div>
              </button>

              {expandedId === log.id && (
                <div className="px-3 pb-3 pt-1 border-t border-slate-100 bg-slate-50">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-slate-500">{t('onlineOrders.logs.platform')}:</span>{' '}
                      <span className="text-slate-700">{log.platform}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">{t('onlineOrders.logs.statusCode')}:</span>{' '}
                      <span className="text-slate-700">{log.statusCode || t('onlineOrders.logs.na')}</span>
                    </div>
                    {log.orderId && (
                      <div className="col-span-2">
                        <span className="text-slate-500">{t('onlineOrders.logs.orderId')}:</span>{' '}
                        <span className="text-slate-700 font-mono text-xs">{log.orderId}</span>
                      </div>
                    )}
                    {log.error && (
                      <div className="col-span-2">
                        <span className="text-slate-500">{t('onlineOrders.logs.error')}:</span>{' '}
                        <span className="text-red-600">{log.error}</span>
                      </div>
                    )}
                    {log.retryCount > 0 && (
                      <div className="col-span-2">
                        <span className="text-slate-500">{t('onlineOrders.logs.retries')}:</span>{' '}
                        <span className="text-slate-700">
                          {log.retryCount}/{log.maxRetries}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-slate-400">
            {t('onlineOrders.logs.showing', { count: logs.length, total })}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="px-3 py-1 text-xs font-medium rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('onlineOrders.logs.previous')}
            </button>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total}
              className="px-3 py-1 text-xs font-medium rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('onlineOrders.logs.next')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlatformLogViewer;
