import { useTranslation } from 'react-i18next';
import { Package, PackageCheck, AlertTriangle, CalendarClock, Wallet } from 'lucide-react';
import StockItemsTab from '../../../features/stock-management/components/StockItemsTab';
import { useStockDashboard, useStockValuation } from '../../../features/stock-management/stockManagementApi';
import { useFormatCurrency } from '../../../hooks/useFormatCurrency';

// Malzemeler = the item catalog plus a slim stat header lifted from the old
// dashboard tab (so the standalone dashboard tab can go away).
export default function ItemsTab() {
  const { t } = useTranslation('stock');
  const formatCurrency = useFormatCurrency();
  const { data: dash } = useStockDashboard();
  const { data: valuation } = useStockValuation();

  const stats = [
    { icon: Package, label: t('dashboard.totalItems', 'Toplam Malzeme'), value: dash?.totalItems ?? '—' },
    { icon: PackageCheck, label: t('dashboard.activeItems', 'Aktif'), value: dash?.activeItems ?? '—' },
    { icon: AlertTriangle, label: t('dashboard.lowStock', 'Düşük Stok'), value: dash?.lowStockCount ?? '—', alert: (dash?.lowStockCount ?? 0) > 0 },
    { icon: CalendarClock, label: t('dashboard.expiringSoon', 'Yaklaşan SKT'), value: dash?.expiringBatchCount ?? '—' },
    { icon: Wallet, label: t('sections.valuation'), value: valuation ? formatCurrency(Number(valuation.totalValue ?? 0)) : '—' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${s.alert ? 'border-rose-200 bg-rose-50' : 'border-slate-200/60 bg-white'}`}
          >
            <s.icon className={`h-4 w-4 shrink-0 ${s.alert ? 'text-rose-600' : 'text-slate-500'}`} />
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-slate-500 truncate">{s.label}</div>
              <div className="text-sm font-semibold text-slate-900 tabular-nums">{s.value}</div>
            </div>
          </div>
        ))}
      </div>
      <StockItemsTab />
    </div>
  );
}
