import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ChevronRight } from 'lucide-react';
import { useTenants, useUpdateTenantStatus } from '../../features/superadmin/api/superAdminApi';
import { TenantFilter, TenantListItem } from '../../features/superadmin/types';

const statusStyles = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  SUSPENDED: 'bg-amber-50 text-amber-700 border-amber-100',
  DELETED: 'bg-red-50 text-red-700 border-red-100',
};

export default function TenantsPage() {
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
    if (window.confirm(`Change status to ${status}?`)) {
      updateStatusMutation.mutate({ id, status });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Tenants</h1>
        <p className="text-sm text-zinc-500 mt-1">Manage restaurant tenants</p>
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
              placeholder="Search tenants..."
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
            />
          </div>
        </form>

        <select
          value={filters.status || ''}
          onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value || undefined, page: 1 }))}
          className="px-4 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
        >
          <option value="">All Status</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="DELETED">Deleted</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-100">
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                Tenant
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                Plan
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                Status
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                Usage
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                Created
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
                  No tenants found
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
                      {tenant._count.users} users · {tenant._count.orders} orders
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

        {/* Pagination */}
        {data && data.meta.totalPages > 1 && (
          <div className="px-5 py-4 border-t border-zinc-100 flex items-center justify-between">
            <span className="text-sm text-zinc-500">
              Page {data.meta.page} of {data.meta.totalPages}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page || 1) - 1 }))}
                disabled={data.meta.page === 1}
                className="px-3 py-1.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <button
                onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page || 1) + 1 }))}
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
