import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { useAuditLogs, useExportAuditLogs } from '../../features/superadmin/api/superAdminApi';
import { AuditLog, AuditFilter } from '../../features/superadmin/types';

const actionStyles: Record<string, string> = {
  LOGIN: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  LOGOUT: 'bg-zinc-50 text-zinc-700 border-zinc-100',
  CREATE: 'bg-blue-50 text-blue-700 border-blue-100',
  UPDATE: 'bg-amber-50 text-amber-700 border-amber-100',
  DELETE: 'bg-red-50 text-red-700 border-red-100',
  SUSPEND: 'bg-orange-50 text-orange-700 border-orange-100',
  ACTIVATE: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  EXTEND: 'bg-violet-50 text-violet-700 border-violet-100',
  CANCEL: 'bg-red-50 text-red-700 border-red-100',
};

export default function AuditLogsPage() {
  const { t } = useTranslation('superadmin');
  const [filters, setFilters] = useState<AuditFilter>({
    page: 1,
    limit: 50,
  });

  const { data, isLoading } = useAuditLogs(filters);
  const exportMutation = useExportAuditLogs();

  const handleExport = async (format: 'csv' | 'json') => {
    const blob = await exportMutation.mutateAsync({ ...filters, format });
    const url = window.URL.createObjectURL(new Blob([blob]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `audit-logs.${format}`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">{t('auditLogs.title')}</h1>
          <p className="text-sm text-zinc-500 mt-1">{t('auditLogs.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleExport('csv')}
            disabled={exportMutation.isPending}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 disabled:opacity-50 transition-colors"
          >
            <Download className="w-4 h-4" />
            {t('auditLogs.csv')}
          </button>
          <button
            onClick={() => handleExport('json')}
            disabled={exportMutation.isPending}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 disabled:opacity-50 transition-colors"
          >
            <Download className="w-4 h-4" />
            {t('auditLogs.json')}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={filters.action || ''}
          onChange={(e) =>
            setFilters({ ...filters, action: e.target.value || undefined, page: 1 })
          }
          className="px-4 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
        >
          <option value="">{t('auditLogs.filters.allActions')}</option>
          <option value="LOGIN">{t('auditLogs.filters.login')}</option>
          <option value="LOGOUT">{t('auditLogs.filters.logout')}</option>
          <option value="CREATE">{t('auditLogs.filters.create')}</option>
          <option value="UPDATE">{t('auditLogs.filters.update')}</option>
          <option value="DELETE">{t('auditLogs.filters.delete')}</option>
          <option value="SUSPEND">{t('auditLogs.filters.suspend')}</option>
          <option value="ACTIVATE">{t('auditLogs.filters.activate')}</option>
        </select>

        <select
          value={filters.entityType || ''}
          onChange={(e) =>
            setFilters({ ...filters, entityType: e.target.value || undefined, page: 1 })
          }
          className="px-4 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
        >
          <option value="">{t('auditLogs.filters.allTypes')}</option>
          <option value="TENANT">{t('auditLogs.filters.tenant')}</option>
          <option value="USER">{t('auditLogs.filters.user')}</option>
          <option value="SUBSCRIPTION">{t('auditLogs.filters.subscription')}</option>
          <option value="PLAN">{t('auditLogs.filters.plan')}</option>
          <option value="SUPER_ADMIN">{t('auditLogs.filters.superAdmin')}</option>
        </select>

        <input
          type="date"
          value={filters.startDate || ''}
          onChange={(e) =>
            setFilters({ ...filters, startDate: e.target.value || undefined, page: 1 })
          }
          className="px-4 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
        />

        <input
          type="date"
          value={filters.endDate || ''}
          onChange={(e) =>
            setFilters({ ...filters, endDate: e.target.value || undefined, page: 1 })
          }
          className="px-4 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="border-b border-zinc-100">
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                {t('auditLogs.col.time')}
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                {t('auditLogs.col.actor')}
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                {t('auditLogs.col.action')}
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                {t('auditLogs.col.entity')}
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                {t('auditLogs.col.target')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center">
                  <div className="flex justify-center">
                    <div className="w-6 h-6 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
                  </div>
                </td>
              </tr>
            ) : (
              data?.data.map((log: AuditLog) => (
                <tr key={log.id} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-5 py-4 text-sm text-zinc-500">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-5 py-4 text-sm text-zinc-900">{log.actorEmail}</td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex px-2 py-0.5 text-xs font-medium rounded border ${
                        actionStyles[log.action] || 'bg-zinc-50 text-zinc-700 border-zinc-100'
                      }`}
                    >
                      {log.action}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-sm text-zinc-500">{log.entityType}</span>
                    {log.entityId && (
                      <span className="text-xs text-zinc-400 ml-1">
                        ({log.entityId.slice(0, 8)}...)
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-sm text-zinc-500">
                    {log.targetTenantName || '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>

        {/* Pagination */}
        {data && data.meta.totalPages > 1 && (
          <div className="px-5 py-4 border-t border-zinc-100 flex items-center justify-between">
            <span className="text-sm text-zinc-500">
              {t('common.pageOfTotal', { page: data.meta.page, totalPages: data.meta.totalPages, total: data.meta.total })}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setFilters({ ...filters, page: (filters.page || 1) - 1 })}
                disabled={data.meta.page === 1}
                className="px-3 py-1.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t('common.previous')}
              </button>
              <button
                onClick={() => setFilters({ ...filters, page: (filters.page || 1) + 1 })}
                disabled={data.meta.page === data.meta.totalPages}
                className="px-3 py-1.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t('common.next')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
