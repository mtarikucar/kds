import { useState } from 'react';
import { useSubscriptions, useExtendSubscription, useCancelSubscription, usePlans } from '../../features/superadmin/api/superAdminApi';
import { SubscriptionListItem } from '../../features/superadmin/types';

const statusStyles: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  CANCELLED: 'bg-red-50 text-red-700 border-red-100',
  EXPIRED: 'bg-zinc-50 text-zinc-700 border-zinc-100',
  PAST_DUE: 'bg-amber-50 text-amber-700 border-amber-100',
  TRIALING: 'bg-blue-50 text-blue-700 border-blue-100',
};

export default function SubscriptionsPage() {
  const [status, setStatus] = useState('');
  const [planId, setPlanId] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useSubscriptions({
    status: status || undefined,
    planId: planId || undefined,
    page,
    limit: 20,
  });
  const { data: plans } = usePlans();
  const extendMutation = useExtendSubscription();
  const cancelMutation = useCancelSubscription();

  const handleExtend = (id: string) => {
    const days = prompt('Enter number of days to extend:');
    if (days && !isNaN(Number(days))) {
      extendMutation.mutate({ id, days: Number(days) });
    }
  };

  const handleCancel = (id: string) => {
    if (window.confirm('Cancel this subscription?')) {
      const reason = prompt('Enter cancellation reason (optional):');
      cancelMutation.mutate({ id, reason: reason || undefined });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Subscriptions</h1>
        <p className="text-sm text-zinc-500 mt-1">Manage tenant subscriptions</p>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="px-4 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
        >
          <option value="">All Status</option>
          <option value="ACTIVE">Active</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="EXPIRED">Expired</option>
          <option value="PAST_DUE">Past Due</option>
          <option value="TRIALING">Trialing</option>
        </select>

        <select
          value={planId}
          onChange={(e) => {
            setPlanId(e.target.value);
            setPage(1);
          }}
          className="px-4 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
        >
          <option value="">All Plans</option>
          {plans?.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.displayName}
            </option>
          ))}
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
                Billing
              </th>
              <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                Ends
              </th>
              <th className="w-28"></th>
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
            ) : (
              data?.data.map((sub: SubscriptionListItem) => (
                <tr key={sub.id} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-5 py-4">
                    <div>
                      <p className="text-sm font-medium text-zinc-900">{sub.tenant.name}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{sub.tenant.subdomain}</p>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sm text-zinc-700">{sub.plan.displayName}</td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex px-2 py-0.5 text-xs font-medium rounded border ${
                        statusStyles[sub.status] || statusStyles.ACTIVE
                      }`}
                    >
                      {sub.status}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <p className="text-sm text-zinc-900">₺{Number(sub.amount).toLocaleString()}</p>
                    <p className="text-xs text-zinc-500">{sub.billingCycle}</p>
                  </td>
                  <td className="px-5 py-4 text-sm text-zinc-500">
                    {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => handleExtend(sub.id)}
                        className="text-xs font-medium text-zinc-600 hover:text-zinc-900 transition-colors"
                      >
                        Extend
                      </button>
                      {sub.status === 'ACTIVE' && (
                        <button
                          onClick={() => handleCancel(sub.id)}
                          className="text-xs font-medium text-red-600 hover:text-red-700 transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
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
                onClick={() => setPage((p) => p - 1)}
                disabled={data.meta.page === 1}
                className="px-3 py-1.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
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
