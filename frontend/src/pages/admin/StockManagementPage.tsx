import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard, Package, BookOpen, Truck, ClipboardList, ArrowRightLeft, Trash2, ClipboardCheck } from 'lucide-react';
import StockDashboard from '../../features/stock-management/components/StockDashboard';
import StockItemsTab from '../../features/stock-management/components/StockItemsTab';
import RecipesTab from '../../features/stock-management/components/RecipesTab';
import SuppliersTab from '../../features/stock-management/components/SuppliersTab';
import PurchaseOrdersTab from '../../features/stock-management/components/PurchaseOrdersTab';
import MovementsTab from '../../features/stock-management/components/MovementsTab';
import WasteLogTab from '../../features/stock-management/components/WasteLogTab';
import StockCountsTab from '../../features/stock-management/components/StockCountsTab';

type TabType = 'dashboard' | 'ingredients' | 'recipes' | 'suppliers' | 'purchaseOrders' | 'movements' | 'waste' | 'stockCount';

const StockManagementPage = () => {
  const { t } = useTranslation('stock');
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');

  const tabs = [
    { id: 'dashboard' as const, label: t('tabs.dashboard'), icon: LayoutDashboard },
    { id: 'ingredients' as const, label: t('tabs.ingredients'), icon: Package },
    { id: 'recipes' as const, label: t('tabs.recipes'), icon: BookOpen },
    { id: 'suppliers' as const, label: t('tabs.suppliers'), icon: Truck },
    { id: 'purchaseOrders' as const, label: t('tabs.purchaseOrders'), icon: ClipboardList },
    { id: 'movements' as const, label: t('tabs.movements'), icon: ArrowRightLeft },
    { id: 'waste' as const, label: t('tabs.waste'), icon: Trash2 },
    { id: 'stockCount' as const, label: t('tabs.stockCount'), icon: ClipboardCheck },
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

      {/* Tabs */}
      <div className="border-b border-gray-200 overflow-x-auto">
        <nav className="flex gap-0 -mb-px">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-emerald-600 text-emerald-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'dashboard' && <StockDashboard />}
      {activeTab === 'ingredients' && <StockItemsTab />}
      {activeTab === 'recipes' && <RecipesTab />}
      {activeTab === 'suppliers' && <SuppliersTab />}
      {activeTab === 'purchaseOrders' && <PurchaseOrdersTab />}
      {activeTab === 'movements' && <MovementsTab />}
      {activeTab === 'waste' && <WasteLogTab />}
      {activeTab === 'stockCount' && <StockCountsTab />}
    </div>
  );
};

export default StockManagementPage;
