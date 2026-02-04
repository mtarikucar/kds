import { useState } from 'react';
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Audit Logs</h1>
          <p className="text-sm text-zinc-500 mt-1">System activity history</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleExport('csv')}
            disabled={exportMutation.isPending}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 disabled:opacity-50 transition-colors"
          >
            <Download className="w-4 h-4" />
            CSV
          </button>
          <button
            onClick={() => handleExport('json')}
            disabled={exportMutation.isPending}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 disabled:opacity-50 transition-colors"
          >
            <Download className="w-4 h-4" />
            JSON
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
          <option value="">All Actions</option>
          <option value="LOGIN">Login</option>
          <option value="LOGOUT">Logout</option>
          <option value="CREATE">Create</option>
          <option value="UPDATE">Update</option>
          <option value="DELETE">Delete</option>
          <option value="SUSPEND">Suspend</option>
          <option value="ACTIVATE">Activate</option>
        </select>

        <select
          value={filters.entityType || ''}
          onChange={(e) =>
            setFilters({ ...filters, entityType: e.target.value || undefined, page: 1 })
          }
          className="px-4 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
        >
          <option value="">All Types</option>
          <option value="TENANT">Tenant</option>
          <option value="USER">User</option>
          <option value="SUBSCRIPTION">Subscription</option>
          <option value="PLAN">Plan</option>
          <option value="SUPER_ADMIN">Super Admin</option>
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
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-100">
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                Time
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                Actor
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                Action
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                Entity
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                Target
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

        {/* Pagination */}
        {data && data.meta.totalPages > 1 && (
          <div className="px-5 py-4 border-t border-zinc-100 flex items-center justify-between">
            <span className="text-sm text-zinc-500">
              Page {data.meta.page} of {data.meta.totalPages} ({data.meta.total} total)
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setFilters({ ...filters, page: (filters.page || 1) - 1 })}
                disabled={data.meta.page === 1}
                className="px-3 py-1.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <button
                onClick={() => setFilters({ ...filters, page: (filters.page || 1) + 1 })}
                disabled={data.meta.page === data.meta.totalPages}
                className="px-3 py-1.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
