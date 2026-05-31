import { useState } from 'react';
import { Building2, ChevronDown, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useBranchScopeStore } from '../../store/branchScopeStore';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { useListBranches } from '../../features/branches/branchesApi';

/**
 * v3.0.0 — active branch picker. Replaces the v2.8.88 "UI-only"
 * version that persisted activeBranchId but didn't drive any
 * query. Now load-bearing: the store value drives the axios
 * X-Branch-Id header on every authenticated request, the
 * Socket.IO handshake's auth.branchId, and the TanStack Query
 * cache key on every branch-scoped hook.
 *
 * Render contract:
 *   - WAITER / KITCHEN / COURIER (`isPinned`) → static locked
 *     badge with the home branch name. No dropdown; UX matches
 *     the BranchGuard hard-restriction at the server.
 *   - ADMIN / MANAGER → dropdown of `allowedBranches`. ADMIN with
 *     an empty allow-list = wildcard tenant access; the picker
 *     shows every active branch in that case.
 *   - Tenants with ≤1 visible branch → component hides itself
 *     (single-branch operation gets no useful affordance).
 */
export default function BranchPicker() {
  const { t } = useTranslation('plan');
  const { hasFeature } = useSubscription();
  const branchId = useBranchScopeStore((s) => s.branchId);
  const allowedBranchIds = useBranchScopeStore((s) => s.allowedBranchIds);
  const isPinned = useBranchScopeStore((s) => s.isPinned);
  const setBranchId = useBranchScopeStore((s) => s.setBranchId);
  const { data: allBranches = [], isLoading } = useListBranches();
  const [open, setOpen] = useState(false);

  if (!hasFeature('multiLocation')) return null;
  if (isLoading) return null;

  // For ADMIN with empty allow-list the picker exposes every active
  // branch; for MANAGER (or ADMIN with an explicit list) the picker
  // is filtered to the allow-list. WAITER's allow-list always
  // contains exactly their primary branch (still rendered via the
  // locked badge branch below).
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

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t('branchPicker.activeTooltip', {
          defaultValue:
            'Aktif şube. Tüm sorgular ve gerçek zamanlı akışlar bu şubeye göre filtrelenir.',
        })}
      >
        <Building2 className="h-4 w-4 text-slate-500" />
        <span className="hidden sm:inline">{label}</span>
        <ChevronDown className="h-3 w-3 text-slate-400" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="listbox"
            className="absolute right-0 mt-1 w-56 rounded-lg border border-slate-200 bg-white shadow-lg z-40"
          >
            {visibleBranches.map((b) => (
              <button
                key={b.id}
                role="option"
                type="button"
                aria-selected={active?.id === b.id}
                onClick={() => {
                  setBranchId(b.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                  active?.id === b.id ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-700'
                }`}
              >
                {b.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
