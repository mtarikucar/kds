import { useState } from 'react';
import { Building2, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { useListBranches } from '../../features/branches/branchesApi';

/**
 * v3.0.0 — global active-branch picker, fully load-bearing.
 *
 * Visible only when (a) the tenant owns `multiLocation` AND (b) they
 * have more than one branch — single-branch tenants get nothing
 * useful from a picker.
 *
 * The Zustand slice (`uiStore.activeBranchId`) drives the axios
 * `X-Branch-Id` header (see lib/api.ts interceptor), so switching the
 * picker swaps the effective branch filter on every query in the SPA
 * without a token refresh.
 *
 * WAITER / KITCHEN / COURIER are hard-pinned to their primary branch
 * by BranchGuard — the picker disables itself and shows the locked
 * branch name. Pre-v3 it was rendered for everyone but did nothing.
 */
export default function BranchPicker() {
  const { t } = useTranslation('plan');
  const { hasFeature } = useSubscription();
  const activeBranchId = useUiStore((s) => s.activeBranchId);
  const setActiveBranchId = useUiStore((s) => s.setActiveBranchId);
  const user = useAuthStore((s) => s.user);
  const { data: branches = [], isLoading } = useListBranches();
  const [open, setOpen] = useState(false);

  // Hard-restricted roles: render the locked branch label only.
  const restrictedRoles = new Set(['WAITER', 'KITCHEN', 'COURIER']);
  const isRestricted = !!user && restrictedRoles.has(user.role);

  // Hide entirely when multiLocation isn't granted or we have ≤1 branch.
  if (!hasFeature('multiLocation')) return null;
  if (isLoading) return null;
  if (branches.length <= 1) return null;

  const active = branches.find((b) => b.id === activeBranchId) ?? null;
  const activeLabel = active
    ? active.name
    : t('branchPicker.activeBranch', {
        defaultValue: 'Aktif şube seçin',
      });

  // Hard-restricted: render a static, non-interactive badge.
  if (isRestricted) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-sm text-slate-600"
        title={t('branchPicker.lockedToPrimary', {
          defaultValue: 'Şubeniz sabittir — değiştirmek için yöneticinize başvurun.',
        })}
      >
        <Building2 className="h-4 w-4 text-slate-500" />
        <span className="hidden sm:inline">{activeLabel}</span>
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
          defaultValue: 'Aktif şube. Tüm sorgular bu şubeye göre filtrelenir.',
        })}
      >
        <Building2 className="h-4 w-4 text-slate-500" />
        <span className="hidden sm:inline">{activeLabel}</span>
        <ChevronDown className="h-3 w-3 text-slate-400" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="listbox"
            className="absolute right-0 mt-1 w-56 rounded-lg border border-slate-200 bg-white shadow-lg z-40"
          >
            {branches.map((b) => (
              <button
                key={b.id}
                role="option"
                type="button"
                aria-selected={active?.id === b.id}
                onClick={() => {
                  setActiveBranchId(b.id);
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
