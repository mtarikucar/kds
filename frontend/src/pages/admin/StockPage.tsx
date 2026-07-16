import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Package, ShoppingCart, ChefHat } from 'lucide-react';
import { cn } from '../../lib/utils';
import StockManagementPage from './StockManagementPage';
import PurchasingPage from './PurchasingPage';
import CostingPage from './CostingPage';

/**
 * Stok — the unified stock/inventory section. Previously three separate
 * sidebar entries + pages (Stok, Satın Alma & Stok, Reçete & Maliyet) that all
 * hit the same stock-management backend. Consolidated into one page with three
 * top-level groups so the operator has a single entry point:
 *   • Envanter — dashboard, ingredients, recipes, suppliers, POs, movements,
 *     waste, counts
 *   • Satın Alma — reorder, bills, AP aging, supplier scorecard, transfers,
 *     valuation, templates/barcode/RMA
 *   • Maliyet & Reçete — menu costing, usage variance, recipe costing
 */
type Group = 'inventory' | 'purchasing' | 'costing';

const StockPage = () => {
  const { t } = useTranslation('stock');
  const [group, setGroup] = useState<Group>('inventory');

  const groups = [
    { id: 'inventory' as const, label: t('groups.inventory', 'Envanter'), icon: Package },
    { id: 'purchasing' as const, label: t('groups.purchasing', 'Satın Alma'), icon: ShoppingCart },
    { id: 'costing' as const, label: t('groups.costing', 'Maliyet & Reçete'), icon: ChefHat },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-emerald-100 rounded-lg">
          <Package className="h-6 w-6 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        </div>
      </div>

      {/* Group switch */}
      <div className="inline-flex rounded-xl bg-slate-100 p-1">
        {groups.map((g) => {
          const Icon = g.icon;
          return (
            <button
              key={g.id}
              onClick={() => setGroup(g.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
                group === g.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700',
              )}
            >
              <Icon className="h-4 w-4" />
              {g.label}
            </button>
          );
        })}
      </div>

      {group === 'inventory' && <StockManagementPage embedded />}
      {group === 'purchasing' && <PurchasingPage embedded />}
      {group === 'costing' && <CostingPage embedded />}
    </div>
  );
};

export default StockPage;
