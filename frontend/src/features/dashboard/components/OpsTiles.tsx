import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LucideIcon, ChefHat, CheckCircle2, Bell, CalendarClock } from 'lucide-react';
import { cn } from '../../../lib/utils';
import Skeleton from '../../../components/ui/Skeleton';
import { useSubscription } from '../../../contexts/SubscriptionContext';
import { useOrders, usePendingOrders, useWaiterRequests, useBillRequests } from '../../orders/ordersApi';
import { useReservationStats } from '../../reservations/reservationsApi';
import { todayRange } from '../lib';

// Live ops tiles refresh policy: the kitchen queue polls (useOrders supports
// options); approvals/calls ride their socket-invalidated caches + mount/focus
// refetch. All tiles fail soft (null) so one bad rail never breaks the page.
const OPS_POLL_MS = 30_000;

interface OpsTileProps {
  to: string;
  icon: LucideIcon;
  label: string;
  primaryText: string;
  hint?: string;
  tone?: 'default' | 'alert';
  isLoading?: boolean;
}

export const OpsTile = ({ to, icon: Icon, label, primaryText, hint, tone = 'default', isLoading }: OpsTileProps) => (
  <Link
    to={to}
    data-testid="ops-tile"
    className={cn(
      'group flex items-center gap-3 rounded-xl border bg-white px-4 py-3 shadow-sm transition-all hover:shadow-md',
      tone === 'alert' ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200/60 hover:border-slate-300',
    )}
  >
    <div
      className={cn(
        'p-2 rounded-lg shrink-0 transition-colors',
        tone === 'alert' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600 group-hover:bg-slate-200',
      )}
    >
      <Icon className="h-5 w-5" />
    </div>
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 truncate">{label}</div>
      {isLoading ? (
        <Skeleton className="h-6 w-10 mt-0.5" />
      ) : (
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold tabular-nums text-slate-900">{primaryText}</span>
          {hint && <span className="text-xs text-slate-500 truncate">{hint}</span>}
        </div>
      )}
    </div>
  </Link>
);

export function KitchenQueueTile() {
  const { t } = useTranslation('common');
  const { data, isLoading, isError } = useOrders(
    { status: 'PENDING,PREPARING,READY' },
    { refetchInterval: OPS_POLL_MS, keepPreviousData: true },
  );
  if (isError) return null;
  const orders = data ?? [];
  const count = (s: string) => orders.filter((o) => o.status === s).length;
  return (
    <OpsTile
      to="/kitchen"
      icon={ChefHat}
      label={t('dashboard.kitchenQueue')}
      primaryText={String(orders.length)}
      hint={`${count('PENDING')} ${t('dashboard.pending')} · ${count('PREPARING')} ${t('dashboard.preparing')} · ${count('READY')} ${t('dashboard.ready')}`}
      isLoading={isLoading}
    />
  );
}

export function ApprovalsTile() {
  const { t } = useTranslation('common');
  const { data, isLoading, isError } = usePendingOrders();
  if (isError) return null;
  const n = (data ?? []).length;
  return (
    <OpsTile
      to="/pos"
      icon={CheckCircle2}
      label={t('dashboard.pendingApproval')}
      primaryText={String(n)}
      tone={n > 0 ? 'alert' : 'default'}
      isLoading={isLoading}
    />
  );
}

export function CallsTile() {
  const { t } = useTranslation('common');
  const waiter = useWaiterRequests();
  const bill = useBillRequests();
  if (waiter.isError && bill.isError) return null;
  const w = (waiter.data ?? []).length;
  const b = (bill.data ?? []).length;
  const n = w + b;
  return (
    <OpsTile
      to="/pos"
      icon={Bell}
      label={t('dashboard.calls')}
      primaryText={String(n)}
      hint={t('dashboard.callsHint', { waiter: w, bill: b })}
      tone={n > 0 ? 'alert' : 'default'}
      isLoading={waiter.isLoading || bill.isLoading}
    />
  );
}

// Gate wrapper: /reservations 403s without the reservationSystem feature.
export function ReservationsTile() {
  const { hasFeature } = useSubscription();
  if (!hasFeature('reservationSystem')) return null;
  return <ReservationsTileInner />;
}

function ReservationsTileInner() {
  const { t } = useTranslation('common');
  const { data, isLoading, isError } = useReservationStats(todayRange().startDate);
  if (isError) return null;
  return (
    <OpsTile
      to="/admin/reservations"
      icon={CalendarClock}
      label={t('dashboard.reservationsToday')}
      primaryText={String(data?.total ?? 0)}
      hint={t('dashboard.reservationsHint', {
        confirmed: data?.confirmed ?? 0,
        pending: data?.pending ?? 0,
      })}
      isLoading={isLoading}
    />
  );
}
