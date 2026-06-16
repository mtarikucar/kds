import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { useAllUsers, useUserActivity } from '../../features/superadmin/api/superAdminApi';
import { UserListItem, UserActivity } from '../../features/superadmin/types';

const roleStyles: Record<string, string> = {
  ADMIN: 'bg-violet-50 text-violet-700 border-violet-100',
  MANAGER: 'bg-blue-50 text-blue-700 border-blue-100',
  WAITER: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  KITCHEN: 'bg-orange-50 text-orange-700 border-orange-100',
  COURIER: 'bg-amber-50 text-amber-700 border-amber-100',
};

export default function AllUsersPage() {
  const { t } = useTranslation('superadmin');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<'users' | 'activity'>('users');

  const { data: usersData, isLoading: usersLoading } = useAllUsers({
    search: search || undefined,
    role: role || undefined,
    page,
    limit: 20,
  });

  const { data: activityData, isLoading: activityLoading } = useUserActivity({
    page,
    limit: 50,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">{t('users.title')}</h1>
        <p className="text-sm text-zinc-500 mt-1">{t('users.subtitle')}</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-zinc-200">
        <nav className="flex gap-6">
          <button
            onClick={() => setActiveTab('users')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'users'
                ? 'border-zinc-900 text-zinc-900'
                : 'border-transparent text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {t('users.tabAllUsers')}
          </button>
          <button
            onClick={() => setActiveTab('activity')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'activity'
                ? 'border-zinc-900 text-zinc-900'
                : 'border-transparent text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {t('users.tabLoginActivity')}
          </button>
        </nav>
      </div>

      {activeTab === 'users' && (
        <>
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder={t('users.searchPlaceholder')}
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
              />
            </div>
            <select
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                setPage(1);
              }}
              className="px-4 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
            >
              <option value="">{t('users.filters.allRoles')}</option>
              <option value="ADMIN">{t('users.filters.admin')}</option>
              <option value="MANAGER">{t('users.filters.manager')}</option>
              <option value="WAITER">{t('users.filters.waiter')}</option>
              <option value="KITCHEN">{t('users.filters.kitchen')}</option>
              <option value="COURIER">{t('users.filters.courier')}</option>
            </select>
          </div>

          {/* Users Table */}
          <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-zinc-100">
                  <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                    {t('users.col.user')}
                  </th>
                  <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                    {t('users.col.tenant')}
                  </th>
                  <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                    {t('users.col.role')}
                  </th>
                  <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                    {t('users.col.status')}
                  </th>
                  <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                    {t('users.col.lastLogin')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {usersLoading ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-12 text-center">
                      <div className="flex justify-center">
                        <div className="w-6 h-6 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
                      </div>
                    </td>
                  </tr>
                ) : (
                  usersData?.data.map((user: UserListItem) => (
                    <tr key={user.id} className="hover:bg-zinc-50 transition-colors">
                      <td className="px-5 py-4">
                        <div>
                          <p className="text-sm font-medium text-zinc-900">
                            {user.firstName} {user.lastName}
                          </p>
                          <p className="text-xs text-zinc-500 mt-0.5">{user.email}</p>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-zinc-500">
                        {user.tenant?.name || '—'}
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex px-2 py-0.5 text-xs font-medium rounded border ${
                            roleStyles[user.role] || 'bg-zinc-50 text-zinc-700 border-zinc-100'
                          }`}
                        >
                          {user.role}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-sm text-zinc-500">{user.status}</td>
                      <td className="px-5 py-4 text-sm text-zinc-500">
                        {user.lastLogin ? new Date(user.lastLogin).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>

            {/* Pagination */}
            {usersData && usersData.meta.totalPages > 1 && (
              <div className="px-5 py-4 border-t border-zinc-100 flex items-center justify-between">
                <span className="text-sm text-zinc-500">
                  {t('common.pageOf', { page: usersData.meta.page, totalPages: usersData.meta.totalPages })}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => p - 1)}
                    disabled={usersData.meta.page === 1}
                    className="px-3 py-1.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {t('common.previous')}
                  </button>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={usersData.meta.page === usersData.meta.totalPages}
                    className="px-3 py-1.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {t('common.next')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'activity' && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-zinc-100">
                <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                  {t('users.col.user')}
                </th>
                <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                  {t('users.col.tenant')}
                </th>
                <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                  {t('users.col.action')}
                </th>
                <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                  {t('users.col.ip')}
                </th>
                <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wider px-5 py-3">
                  {t('users.col.time')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {activityLoading ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center">
                    <div className="flex justify-center">
                      <div className="w-6 h-6 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
                    </div>
                  </td>
                </tr>
              ) : (
                activityData?.data.map((activity: UserActivity) => (
                  <tr key={activity.id} className="hover:bg-zinc-50 transition-colors">
                    <td className="px-5 py-4">
                      <div>
                        <p className="text-sm text-zinc-900">
                          {activity.user
                            ? `${activity.user.firstName} ${activity.user.lastName}`
                            : activity.userId}
                        </p>
                        <p className="text-xs text-zinc-500 mt-0.5">{activity.user?.email}</p>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm text-zinc-500">
                      {activity.tenant?.name || '—'}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex px-2 py-0.5 text-xs font-medium rounded border ${
                          activity.action === 'LOGIN'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                            : activity.action === 'LOGOUT'
                            ? 'bg-zinc-50 text-zinc-700 border-zinc-100'
                            : 'bg-red-50 text-red-700 border-red-100'
                        }`}
                      >
                        {activity.action}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-sm text-zinc-500">{activity.ip || '—'}</td>
                    <td className="px-5 py-4 text-sm text-zinc-500">
                      {new Date(activity.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
