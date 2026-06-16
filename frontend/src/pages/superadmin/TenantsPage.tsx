import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, ChevronRight } from 'lucide-react';
import { useTenants, useUpdateTenantStatus } from '../../features/superadmin/api/superAdminApi';
import { TenantFilter, TenantListItem } from '../../features/superadmin/types';

const statusStyles = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  SUSPENDED: 'bg-amber-50 text-amber-700 border-amber-100',
  DELETED: 'bg-red-50 text-red-700 border-red-100',
};

export default function TenantsPage() {
  const { t } = useTranslation('superadmin');
  const [filters, setFilters] = useState<TenantFilter>({
    page: 1,
    limit: 20,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });
  const [search, setSearch] = useState('');

  const { data, isLoading } = useTenants({ ...filters, search: search || undefined });
  const updateStatusMutation = useUpdateTenantStatus();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setFilters((prev) => ({ ...prev, page: 1 }));
  };

  const handleStatusChange = (id: string, status: string) => {
    if (window.confirm(t('tenants.confirmStatusChange', { status }))) {
      updateStatusMutation.mutate({ id, status });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">{t('tenants.title')}</h1>
        <p className="text-sm text-zinc-500 mt-1">{t('tenants.subtitle')}</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <form onSubmit={handleSearch} className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('tenants.searchPlaceholder')}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
            />
          </div>
        </form>

        <select
          value={filters.status || ''}
          onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value || undefined, page: 1 }))}
          className="px-4 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
        >
          <option value="">{t('tenants.filters.allStatus')}</option>
          <option value="ACTIVE">{t('tenants.filters.active')}</option>
          <option value="SUSPENDED">{t('tenants.filters.suspended')}</option>
          <option value="DELETED">{t('tenants.filters.deleted')}</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="border-b border-zinc-100">
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                {t('tenants.col.tenant')}
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                {t('tenants.col.plan')}
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                {t('tenants.col.status')}
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                {t('tenants.col.usage')}
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                {t('tenants.col.created')}
              </th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center">
                  <div className="flex justify-center">
                    <div className="w-6 h-6 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
                  </div>
                </td>
              </tr>
            ) : data?.data.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-sm text-zinc-500">
                  {t('tenants.noTenantsFound')}
                </td>
              </tr>
            ) : (
              data?.data.map((tenant: TenantListItem) => (
                <tr key={tenant.id} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-5 py-4">
                    <div>
                      <p className="text-sm font-medium text-zinc-900">{tenant.name}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{tenant.subdomain}</p>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-sm text-zinc-700">
                      {tenant.currentPlan?.displayName || '—'}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex px-2 py-0.5 text-xs font-medium rounded border ${
                        statusStyles[tenant.status as keyof typeof statusStyles] || statusStyles.ACTIVE
                      }`}
                    >
                      {tenant.status}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-sm text-zinc-500">
                      {t('tenants.usage', { users: tenant._count.users, orders: tenant._count.orders })}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-sm text-zinc-500">
                      {new Date(tenant.createdAt).toLocaleDateString()}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <Link
                      to={`/superadmin/tenants/${tenant.id}`}
                      className="p-1.5 rounded-lg hover:bg-zinc-100 transition-colors inline-flex"
                    >
                      <ChevronRight className="w-4 h-4 text-zinc-400" />
                    </Link>
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
              {t('common.pageOf', { page: data.meta.page, totalPages: data.meta.totalPages })}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page || 1) - 1 }))}
                disabled={data.meta.page === 1}
                className="px-3 py-1.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t('common.previous')}
              </button>
              <button
                onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page || 1) + 1 }))}
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
