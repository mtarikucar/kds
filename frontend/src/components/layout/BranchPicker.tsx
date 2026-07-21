import { ArrowLeftRight, Building2, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useBranchScopeStore } from '../../store/branchScopeStore';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { useListBranches } from '../../features/branches/branchesApi';

/**
 * Navbar active-branch control. The store value drives the axios
 * X-Branch-Id header on every authenticated request, the Socket.IO
 * handshake's auth.branchId, and the TanStack Query cache key on every
 * branch-scoped hook.
 *
 * 2026-07-22: the in-place dropdown is gone — switching now happens on
 * the full-screen /branch-select page. This renders the active branch
 * plus a "Switch branch" button navigating there (carrying the current
 * path so the screen returns the user where they were).
 *
 * Render contract (unchanged):
 *   - WAITER / KITCHEN / COURIER (`isPinned`) → static locked badge.
 *   - Tenants with ≤1 visible branch → hides itself entirely.
 */
export default function BranchPicker() {
  const { t } = useTranslation('plan');
  const navigate = useNavigate();
  const location = useLocation();
  const { hasFeature } = useSubscription();
  const branchId = useBranchScopeStore((s) => s.branchId);
  const allowedBranchIds = useBranchScopeStore((s) => s.allowedBranchIds);
  const isPinned = useBranchScopeStore((s) => s.isPinned);
  const { data: allBranches = [], isLoading } = useListBranches();

  if (!hasFeature('multiLocation')) return null;
  if (isLoading) return null;

  // ADMIN with an empty allow-list = wildcard tenant access; an explicit
  // list (MANAGER, scoped ADMIN) filters what is visible.
  const visibleBranches =
    allowedBranchIds.length > 0
      ? allBranches.filter((b) => allowedBranchIds.includes(b.id))
      : allBranches;

  if (visibleBranches.length <= 1 && !isPinned) return null;

  const active = visibleBranches.find((b) => b.id === branchId) ?? null;
  const label = active?.name ?? t('branchPicker.activeBranch', { defaultValue: 'Aktif şube seçin' });

  if (isPinned) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-sm text-slate-600"
        title={t('branchPicker.lockedToPrimary', {
          defaultValue:
            'Şubeniz sabit. Değiştirmek için yöneticinize başvurun.',
        })}
      >
        <Lock className="h-4 w-4 text-slate-500" />
        <span className="hidden sm:inline">{label}</span>
      </div>
    );
  }

  const changeLabel = t('branchPicker.changeBranch', { defaultValue: 'Şube değiştir' });

  return (
    <div className="flex items-center gap-1.5">
      <div
        className="hidden sm:flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700"
        title={t('branchPicker.activeTooltip', {
          defaultValue:
            'Aktif şube. Tüm sorgular ve gerçek zamanlı akışlar bu şubeye göre filtrelenir.',
        })}
      >
        <Building2 className="h-4 w-4 text-slate-500" />
        <span className="max-w-[10rem] truncate">{label}</span>
      </div>
      <button
        type="button"
        onClick={() => navigate('/branch-select', { state: { from: location.pathname } })}
        aria-label={changeLabel}
        title={changeLabel}
        className="flex items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-primary-100 transition-colors"
      >
        <ArrowLeftRight className="h-4 w-4" />
        <span className="hidden md:inline">{changeLabel}</span>
      </button>
    </div>
  );
}
