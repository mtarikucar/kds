import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Check, Crown, LogOut, Settings2 } from 'lucide-react';
import { useListBranches, type Branch } from './branchesApi';
import { useBranchScopeStore } from '../../store/branchScopeStore';
import { useAuthStore } from '../../store/authStore';
import { useLogout } from '../auth/authApi';
import Spinner from '../../components/ui/Spinner';

/**
 * Full-screen branch switcher (2026-07-22). Reached two ways:
 *   - voluntarily, from the navbar "Switch branch" button (BranchPicker);
 *   - forced, by BranchSelectionGate on a device with no explicit prior
 *     selection for a multi-branch user (branchScopeStore.branchChosen).
 * Renders OUTSIDE Layout (no app chrome, like /welcome) so the forced mode
 * has no sidebar/header escape hatches; a back affordance only shows on
 * voluntary visits. Branch management stays on /admin/branches — this
 * screen links there (its sidebar entry was removed).
 */
const BranchSelectPage = () => {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const location = useLocation();
  const { data: branches = [], isLoading } = useListBranches();
  const branchId = useBranchScopeStore((s) => s.branchId);
  const allowedBranchIds = useBranchScopeStore((s) => s.allowedBranchIds);
  const isWildcard = useBranchScopeStore((s) => s.isWildcard);
  const branchChosen = useBranchScopeStore((s) => s.branchChosen);
  const setBranchId = useBranchScopeStore((s) => s.setBranchId);
  const user = useAuthStore((s) => s.user);
  const { mutate: logout } = useLogout();

  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';
  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  // Same visibility rule as the navbar picker (mirrors backend
  // BranchGuard): wildcard (ADMIN + empty allow-list) exposes every
  // branch; everyone else — including a non-ADMIN with an empty
  // allow-list, a data bug rather than intentional all-access — only
  // sees their explicit list.
  const visibleBranches = isWildcard
    ? branches
    : branches.filter((b) => allowedBranchIds.includes(b.id));

  const choose = (branch: Branch) => {
    if (branch.status !== 'active') return;
    setBranchId(branch.id);
    navigate(from, { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/20 mb-4">
            <Building2 className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-heading font-bold text-slate-900">
            {t('branchSelect.title')}
          </h1>
          <p className="mt-1.5 text-slate-500 max-w-md mx-auto">
            {t('branchSelect.subtitle')}
          </p>
        </div>

        {/* Branch cards */}
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : visibleBranches.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/60 py-12 text-center">
            <h2 className="text-lg font-semibold text-slate-900">{t('branchSelect.empty')}</h2>
            <p className="mt-2 text-sm text-slate-500">{t('branchSelect.emptyHint')}</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {visibleBranches.map((branch) => {
              const isActive = branch.id === branchId;
              const selectable = branch.status === 'active';
              return (
                <button
                  key={branch.id}
                  type="button"
                  onClick={() => choose(branch)}
                  // aria-disabled (not `disabled`) keeps suspended/archived
                  // branches in the tab order so keyboard/SR users still reach
                  // them and hear their status; choose() ignores the click.
                  aria-disabled={!selectable}
                  className={`group relative flex items-center gap-3 rounded-2xl border bg-white p-4 text-start transition-all ${
                    isActive
                      ? 'border-primary-300 ring-2 ring-primary-500/30'
                      : 'border-slate-200/70 hover:border-primary-200 hover:shadow-md'
                  } ${selectable ? '' : 'opacity-60 cursor-not-allowed'}`}
                >
                  <div
                    className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                      isActive ? 'bg-primary-100 text-primary-600' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900 truncate">{branch.name}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                      {branch.code && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-mono">
                          {branch.code}
                        </span>
                      )}
                      {branch.isHeadquarters && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
                          <Crown className="h-3 w-3" />
                          {t('branchSelect.headquarters')}
                        </span>
                      )}
                      {branch.status !== 'active' && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                          {branch.status === 'suspended'
                            ? t('branchSelect.suspended')
                            : t('branchSelect.archived')}
                        </span>
                      )}
                    </div>
                  </div>
                  {isActive && (
                    <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-primary-600">
                      <Check className="h-4 w-4" />
                      <span className="hidden sm:inline">{t('branchSelect.activeBadge')}</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Footer actions */}
        <div className="mt-8 flex items-center justify-center gap-4">
          {branchChosen ? (
            <button
              type="button"
              onClick={() => navigate(from, { replace: true })}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700"
            >
              <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
              {t('app.back')}
            </button>
          ) : (
            // Forced first-entry mode has no back/app chrome — offer logout so a
            // wrong-account user on a shared device isn't trapped into mutating
            // the (X-Branch-Id-driving) store under the wrong identity.
            <button
              type="button"
              onClick={() => logout()}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700"
            >
              <LogOut className="h-4 w-4 rtl:rotate-180" />
              {t('app.logout')}
            </button>
          )}
          {canManage && (
            <Link
              to="/admin/branches"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
            >
              <Settings2 className="h-4 w-4" />
              {t('branchSelect.manageBranches')}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};

export default BranchSelectPage;
