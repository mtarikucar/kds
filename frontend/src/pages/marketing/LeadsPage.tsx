import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PlusIcon, MagnifyingGlassIcon, FunnelIcon } from '@heroicons/react/24/outline';
import marketingApi from '../../features/marketing/api/marketingApi';
import { LeadStatusBadge } from '../../features/marketing/components';
import {
  LeadStatus,
  BusinessType,
  LeadSource,
  LEAD_STATUS_LABELS,
  BUSINESS_TYPE_LABELS,
  LEAD_SOURCE_LABELS,
} from '../../features/marketing/types';
import type { Lead, PaginatedResponse } from '../../features/marketing/types';

export default function LeadsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['marketing', 'leads', { search, status, source, businessType, page }],
    queryFn: () =>
      marketingApi
        .get<PaginatedResponse<Lead>>('/leads', {
          params: {
            search: search || undefined,
            status: status || undefined,
            source: source || undefined,
            businessType: businessType || undefined,
            page,
            limit: 20,
          },
        })
        .then((r) => r.data),
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
        <Link
          to="/marketing/leads/new"
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <PlusIcon className="w-4 h-4" />
          New Lead
        </Link>
      </div>

      {/* Search & Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search leads..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-sm ${
              showFilters ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-300 text-gray-600'
            }`}
          >
            <FunnelIcon className="w-4 h-4" />
            Filters
          </button>
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3 pt-3 border-t">
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">All Statuses</option>
              {Object.values(LeadStatus).map((s) => (
                <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
              ))}
            </select>
            <select
              value={source}
              onChange={(e) => { setSource(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">All Sources</option>
              {Object.values(LeadSource).map((s) => (
                <option key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</option>
              ))}
            </select>
            <select
              value={businessType}
              onChange={(e) => { setBusinessType(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">All Business Types</option>
              {Object.values(BusinessType).map((b) => (
                <option key={b} value={b}>{BUSINESS_TYPE_LABELS[b]}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500">
                <th className="px-4 py-3 font-medium">Business</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Source</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">City</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">Assigned To</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : data?.data.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    No leads found
                  </td>
                </tr>
              ) : (
                data?.data.map((lead) => (
                  <tr key={lead.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        to={`/marketing/leads/${lead.id}`}
                        className="font-medium text-indigo-600 hover:text-indigo-800"
                      >
                        {lead.businessName}
                      </Link>
                      <p className="text-xs text-gray-400">{BUSINESS_TYPE_LABELS[lead.businessType as BusinessType] || lead.businessType}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-900">{lead.contactPerson}</p>
                      <p className="text-xs text-gray-400">{lead.phone}</p>
                    </td>
                    <td className="px-4 py-3">
                      <LeadStatusBadge status={lead.status} />
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-gray-600">
                      {LEAD_SOURCE_LABELS[lead.source as LeadSource] || lead.source}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-gray-600">
                      {lead.city || '-'}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-gray-600">
                      {lead.assignedTo
                        ? `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`
                        : '-'}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-gray-400 text-xs">
                      {new Date(lead.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.meta.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <p className="text-sm text-gray-500">
              Showing {(data.meta.page - 1) * data.meta.limit + 1} to{' '}
              {Math.min(data.meta.page * data.meta.limit, data.meta.total)} of{' '}
              {data.meta.total}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(page - 1)}
                disabled={page === 1}
                className="px-3 py-1 border rounded text-sm disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page >= data.meta.totalPages}
                className="px-3 py-1 border rounded text-sm disabled:opacity-50"
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
