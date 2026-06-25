import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useGetMyEntitlements } from '../entitlements/entitlementsApi';
import { useListBranches } from '../branches/branchesApi';
import { useListDevices } from '../devices/devicesApi';
import { useListBridges } from '../bridges/bridgesApi';

/**
 * Dashboard banner that walks a new tenant through the first-time setup.
 *
 * The list is data-driven: each item checks a real condition (branch
 * exists, KDS device paired, bridge online, etc.) and links to the page
 * that resolves it. Hides itself entirely once every item is checked, so
 * mature tenants don't see the banner.
 *
 * Cheap to render — every query is already prefetched on dashboard load.
 */
export default function SetupChecklist() {
  const { t } = useTranslation('common');
  const { data: ents } = useGetMyEntitlements();
  const { data: branches = [] } = useListBranches();
  const { data: devices = [] } = useListDevices();
  const { data: bridges = [] } = useListBridges();

  const items = [
    {
      key: 'branch',
      label: t('hummytummy.setupChecklist.items.branch'),
      done: branches.length > 0,
      link: { to: '/admin/branches', label: t('navigation.branches') },
    },
    {
      key: 'kds',
      label: t('hummytummy.setupChecklist.items.kds'),
      done: devices.some((d) => d.kind === 'kds_screen' && d.status !== 'unprovisioned'),
      link: { to: '/admin/branches', label: t('navigation.branches') },
      skip: !(ents?.features['feature.kdsIntegration']),
    },
    {
      key: 'tablet',
      label: t('hummytummy.setupChecklist.items.tablet'),
      done: devices.some((d) => d.kind === 'tablet_waiter' && d.status !== 'unprovisioned'),
      link: { to: '/admin/branches', label: t('navigation.branches') },
    },
    {
      key: 'bridge',
      label: t('hummytummy.setupChecklist.items.bridge'),
      done: bridges.some((b) => b.status === 'online'),
      link: { to: '/admin/branches', label: t('navigation.branches') },
      skip:
        !devices.some((d) => ['yazarkasa', 'receipt_printer', 'kitchen_printer', 'pos_terminal'].includes(d.kind)),
    },
    {
      key: 'fiscal',
      label: t('hummytummy.setupChecklist.items.fiscal'),
      done: (ents?.integrations['integration.fiscal'] ?? []).length > 0,
      link: { to: '/admin/marketplace?kind=integration', label: t('navigation.marketplace') },
    },
  ].filter((i) => !i.skip);

  const remaining = items.filter((i) => !i.done);
  if (remaining.length === 0 || items.length === 0) return null;

  const total = items.length;
  const done = total - remaining.length;
  const pct = Math.round((done / total) * 100);

  return (
    <section className="rounded-lg border border-blue-200 bg-blue-50 p-4">
      <header className="flex items-center justify-between">
        <h2 className="font-semibold text-blue-900">{t('hummytummy.setupChecklist.title')}</h2>
        <span className="text-xs text-blue-700">
          {done}/{total} · {pct}%
        </span>
      </header>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-blue-100">
        <div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-3 space-y-1.5">
        {items.map((item) => (
          <li key={item.key} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full text-xs ${
                  item.done ? 'bg-green-600 text-white' : 'border border-blue-400 bg-white text-blue-600'
                }`}
              >
                {item.done ? '✓' : ''}
              </span>
              <span className={item.done ? 'text-gray-500 line-through' : 'text-gray-900'}>
                {item.label}
              </span>
            </span>
            {!item.done && (
              <Link to={item.link.to} className="text-xs text-blue-700 hover:underline">
                {t('hummytummy.setupChecklist.goTo', { label: item.link.label })}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
