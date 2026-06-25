import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Store, Puzzle, Cpu, Truck } from 'lucide-react';
import MarketplacePage from '../marketplace/MarketplacePage';
import StorePage from '../hardware-store/StorePage';
import HardwareOrdersListPage from '../hardware-store/HardwareOrdersListPage';

type Tab = 'addons' | 'hardware' | 'orders';
const TABS: Tab[] = ['addons', 'hardware', 'orders'];
const TAB_ICON: Record<Tab, typeof Cpu> = { addons: Puzzle, hardware: Cpu, orders: Truck };

/**
 * Consolidated "Mağaza" hub — one home for the add-on marketplace, the hardware
 * store and hardware orders, reached from the top-bar store icon (no longer a
 * sidebar section). Each tab renders the existing page in `embedded` mode so
 * the hub owns the single page header.
 */
export default function StoreHubPage() {
  const { t } = useTranslation('common');
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') as Tab | null;
  // A `?sku=` deeplink (the public landing "Sipariş ver" CTA → /admin/store?sku=)
  // is the hardware store's SKU bridge: StorePage's mount effect reads ?sku=,
  // auto-adds the product (or redirects services to the detail page). It only
  // runs when StorePage is mounted, i.e. the 'hardware' tab — so a bare ?sku=
  // (no ?tab=) must open on 'hardware', not the default 'addons', or the bridge
  // silently no-ops and the buy link is dead.
  const hasSku = !!params.get('sku');
  const tab: Tab = raw && TABS.includes(raw) ? raw : hasSku ? 'hardware' : 'addons';

  // Pin the derived tab to the URL when a ?sku= deeplink picked it, so once
  // StorePage strips ?sku= the tab stays 'hardware' (without this, the next
  // render would have no tab + no sku and fall back to 'addons', unmounting
  // StorePage right after it added the item).
  useEffect(() => {
    if (hasSku && !raw) {
      const p = new URLSearchParams(params);
      p.set('tab', 'hardware');
      setParams(p, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSku, raw]);

  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
          <Store className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {t('hummytummy.storeHub.title', { defaultValue: 'Mağaza' })}
          </h1>
          <p className="text-sm text-slate-500">
            {t('hummytummy.storeHub.subtitle', {
              defaultValue: 'Eklentiler, donanım ve siparişlerin tek yerden.',
            })}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((key) => {
          const Icon = TAB_ICON[key];
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={
                'inline-flex flex-shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ' +
                (active
                  ? 'border-primary-500 text-primary-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700')
              }
            >
              <Icon className="h-4 w-4" />
              {t(`hummytummy.storeHub.tabs.${key}`, {
                defaultValue:
                  key === 'addons' ? 'Eklentiler' : key === 'hardware' ? 'Donanım' : 'Siparişlerim',
              })}
            </button>
          );
        })}
      </div>

      {/* Active tab */}
      <div>
        {tab === 'addons' && <MarketplacePage embedded />}
        {tab === 'hardware' && <StorePage embedded />}
        {tab === 'orders' && <HardwareOrdersListPage embedded />}
      </div>
    </div>
  );
}
