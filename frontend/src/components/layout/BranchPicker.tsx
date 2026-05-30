import { useState } from 'react';
import { Building2, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../store/uiStore';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { useListBranches } from '../../features/branches/branchesApi';

/**
 * v2.8.88 — global active-branch picker (UI shell).
 *
 * Visible only when (a) the tenant owns `multiLocation` AND (b) they
 * have more than one branch — single-branch tenants get nothing
 * useful from a picker.
 *
 * **This PR's wiring is UI-only.** The Zustand slice
 * (`uiStore.activeBranchId`) persists across reloads but the picker
 * does not yet filter reports / devices / invoices queries. A small
 * tooltip below the dropdown signals this — to remove the half-wired
 * trust gap, follow-up PR plumbs `branchId` into the relevant React
 * Query keys.
 */
export default function BranchPicker() {
  const { t } = useTranslation('plan');
  const { hasFeature } = useSubscription();
  const activeBranchId = useUiStore((s) => s.activeBranchId);
  const setActiveBranchId = useUiStore((s) => s.setActiveBranchId);
  const { data: branches = [], isLoading } = useListBranches();
  const [open, setOpen] = useState(false);

  // Hide entirely when multiLocation isn't granted or we have ≤1 branch.
  if (!hasFeature('multiLocation')) return null;
  if (isLoading) return null;
  if (branches.length <= 1) return null;

  const active = branches.find((b) => b.id === activeBranchId) ?? null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t('branchPicker.comingSoon', {
          defaultValue: 'Şube filtresi yakında raporlara ve sipariş listelerine eklenecek.',
        })}
      >
        <Building2 className="h-4 w-4 text-slate-500" />
        <span className="hidden sm:inline">
          {active
            ? active.name
            : t('branchPicker.allBranches', { defaultValue: 'Tüm şubeler' })}
        </span>
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
            <button
              role="option"
              type="button"
              aria-selected={!active}
              onClick={() => {
                setActiveBranchId(null);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                !active ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-700'
              }`}
            >
              {t('branchPicker.allBranches', { defaultValue: 'Tüm şubeler' })}
            </button>
            <div className="border-t" />
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
            <div className="border-t bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              {t('branchPicker.comingSoonHint', {
                defaultValue:
                  'Şube filtresi yakında — şu an raporlar ve sipariş listeleri tüm şubeleri gösteriyor.',
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
