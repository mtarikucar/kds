import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Compass, Package, ClipboardList, Truck, ChefHat, Wrench, LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { STOCK_TABS, parseStockTab, type StockTab } from './stockTabs';
import GuidanceTab from './stock/GuidanceTab';
import ItemsTab from './stock/ItemsTab';
import OrdersTab from './stock/OrdersTab';
import SuppliersHub from './stock/SuppliersHub';
import CostingTab from './stock/CostingTab';
import OperationsTab from './stock/OperationsTab';

const ICONS: Record<StockTab, LucideIcon> = {
  guide: Compass,
  items: Package,
  orders: ClipboardList,
  suppliers: Truck,
  costing: ChefHat,
  operations: Wrench,
};

// Tab lives in the URL (?tab=…) so refresh/deep-link/back all work — same
// convention as Tables (?view). Unknown tab → guide.
const StockPage = () => {
  const { t } = useTranslation('stock');
  const [searchParams, setSearchParams] = useSearchParams();
  const active = parseStockTab(searchParams.get('tab'));

  const setTab = (tab: StockTab) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tab === 'guide') next.delete('tab');
        else next.set('tab', tab);
        return next;
      },
      { replace: false },
    );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-emerald-100 rounded-lg">
          <Package className="h-6 w-6 text-emerald-600" />
        </div>
        <h1 className="text-2xl font-heading font-bold text-slate-900">{t('title')}</h1>
      </div>

      <div className="border-b border-slate-200 overflow-x-auto">
        <nav className="flex gap-0 -mb-px" role="tablist" aria-label={t('title')}>
          {STOCK_TABS.map((tab) => {
            const Icon = ICONS[tab];
            const selected = active === tab;
            return (
              <button
                key={tab}
                role="tab"
                aria-selected={selected}
                onClick={() => setTab(tab)}
                className={cn(
                  'flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                  selected
                    ? 'border-emerald-600 text-emerald-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
                )}
              >
                <Icon className="h-4 w-4" />
                {t(`nav.${tab}`)}
              </button>
            );
          })}
        </nav>
      </div>

      {active === 'guide' && <GuidanceTab />}
      {active === 'items' && <ItemsTab />}
      {active === 'orders' && <OrdersTab />}
      {active === 'suppliers' && <SuppliersHub />}
      {active === 'costing' && <CostingTab />}
      {active === 'operations' && <OperationsTab />}
    </div>
  );
};

export default StockPage;
