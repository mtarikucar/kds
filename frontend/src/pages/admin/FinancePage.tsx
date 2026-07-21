import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { LayoutDashboard, Wallet, Receipt } from 'lucide-react';
import { cn } from '../../lib/utils';
import CashPage from './CashPage';
import AccountingBackOfficePage from './AccountingBackOfficePage';
import FinanceOverview from './finance/FinanceOverview';

/**
 * Finans — tek çatı: Genel Bakış (bugün ne durumdayım) + Kasa (eski Nakit &
 * ÖKC) + Belgeler (eski Muhasebe + Fiş Kurtarma). Eski rotalar (/admin/cash,
 * /admin/accounting-backoffice, /admin/invoices, /admin/fiscal-recovery)
 * App.tsx'te buraya redirect eder.
 * Desen: grup anahtarı + embedded prop (bkz. ReportsAnalyticsPage, StockPage).
 * Gate yok: kasa/vardiya + fatura kesme yasal çekirdek — her planda açık.
 */
type Group = 'overview' | 'cash' | 'documents';
const VALID_GROUPS: readonly Group[] = ['overview', 'cash', 'documents'];

const FinancePage = () => {
  const { t } = useTranslation('common');
  const [searchParams] = useSearchParams();
  const requested = searchParams.get('group');
  const [group, setGroup] = useState<Group>(
    VALID_GROUPS.includes(requested as Group) ? (requested as Group) : 'overview',
  );
  // overview'daki bir aksiyon Belgeler grubuna belirli bir sekme hedefiyle geçebilir.
  const [docTab, setDocTab] = useState<string | undefined>(undefined);

  const groups = [
    { id: 'overview' as const, label: t('finance.groups.overview', 'Genel Bakış'), icon: LayoutDashboard },
    { id: 'cash' as const, label: t('finance.groups.cash', 'Kasa'), icon: Wallet },
    { id: 'documents' as const, label: t('finance.groups.documents', 'Belgeler'), icon: Receipt },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold text-slate-900">
          {t('navigation.finance', 'Finans')}
        </h1>
      </div>

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

      {group === 'overview' && (
        <FinanceOverview
          onNavigate={(g, tab) => {
            setDocTab(tab);
            setGroup(g);
          }}
        />
      )}
      {group === 'cash' && <CashPage embedded />}
      {group === 'documents' && <AccountingBackOfficePage embedded initialTab={docTab} />}
    </div>
  );
};

export default FinancePage;
