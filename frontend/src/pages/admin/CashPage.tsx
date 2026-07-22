import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { format, subDays } from 'date-fns';
import { useForm } from 'react-hook-form';
import { Wallet, Coins, Landmark, FileText } from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '../../components/ui/Card';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import {
  useCashierSessions,
  useXReport,
  useCreateCashMovement,
  useTipDistribution,
  downloadSessionsCsv,
} from '../../features/cash/cashApi';
import { useSubscription } from '../../contexts/SubscriptionContext';
import type { PlanFeatures } from '../../types';
import ZReportsSection from '../../components/reports/ZReportsSection';

type Tab = 'sessions' | 'safe' | 'tips' | 'dayend';

export default function CashPage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation('common');
  const fmt = useFormatCurrency();
  const [tab, setTab] = useState<Tab>('sessions');
  const { hasFeature } = useSubscription();
  const allTabs = [
    { id: 'sessions' as Tab, label: t('cash.tabs.sessions', 'Vardiyalar'), icon: Wallet, gate: undefined as keyof PlanFeatures | undefined },
    { id: 'safe' as Tab, label: t('cash.tabs.safe', 'Kasa Hareketleri'), icon: Landmark, gate: undefined },
    { id: 'dayend' as Tab, label: t('cash.tabs.dayend', 'Gün Sonu'), icon: FileText, gate: undefined },
    { id: 'tips' as Tab, label: t('cash.tabs.tips', 'Bahşiş'), icon: Coins, gate: 'advancedReports' as keyof PlanFeatures },
  ];
  const tabs = allTabs.filter((tb) => !tb.gate || hasFeature(tb.gate));
  return (
    <div className={embedded ? 'space-y-6' : 'p-4 sm:p-6 space-y-6'}>
      {!embedded && (
        <div>
          <h1 className="text-2xl font-bold">{t('cash.title')}</h1>
          <p className="text-sm text-slate-500">{t('cash.subtitle')}</p>
        </div>
      )}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map((tb) => {
          const Icon = tb.icon;
          return (
            <button key={tb.id} onClick={() => setTab(tb.id)}
              className={`flex items-center gap-2 whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === tb.id ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              <Icon className="h-4 w-4" />{tb.label}
            </button>
          );
        })}
      </div>
      {tab === 'sessions' && <SessionsTab fmt={fmt} />}
      {tab === 'safe' && <SafeTab fmt={fmt} />}
      {tab === 'tips' && <TipsTab fmt={fmt} />}
      {tab === 'dayend' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={async () => {
                try {
                  await downloadSessionsCsv();
                } catch {
                  toast.error(t('cash.dayend.csvError'));
                }
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              {t('cash.dayend.csv')}
            </button>
          </div>
          <ZReportsSection />
        </div>
      )}
    </div>
  );
}

type Fmt = (n: number) => string;

function SessionsTab({ fmt }: { fmt: Fmt }) {
  const { t } = useTranslation('common');
  const { data: sessions, isLoading } = useCashierSessions('OPEN');
  const [selected, setSelected] = useState<string | undefined>();
  const { data: x, isLoading: xLoading } = useXReport(selected);
  if (isLoading) return <Loading />;
  return (
    <div className="space-y-4">
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader><CardTitle>{t('cash.sessions.open')}</CardTitle></CardHeader>
        <CardContent>
          {(!sessions || sessions.length === 0) ? <Empty text={t('cash.sessions.none')} /> : (
            <ul className="divide-y divide-slate-100">
              {sessions.map((s: any) => (
                <li key={s.id}>
                  <button onClick={() => setSelected(s.id)}
                    className={`w-full text-left py-2 px-1 text-sm hover:bg-slate-50 ${selected === s.id ? 'bg-indigo-50' : ''}`}>
                    {t('cash.sessions.row', { id: s.id.slice(0, 8), amount: fmt(Number(s.openingFloat)) })}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t('cash.xreport.title')}</CardTitle></CardHeader>
        <CardContent>
          {xLoading ? <Loading /> : !x ? <Empty text={t('cash.xreport.pick')} /> : (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <KV label={t('cash.xreport.opening')} value={fmt(x.openingFloat)} />
              <KV label={t('cash.xreport.cashSales')} value={fmt(x.cashSales)} />
              <KV label={t('cash.xreport.cashIn')} value={fmt(x.cashIn)} />
              <KV label={t('cash.xreport.cashOut')} value={fmt(x.cashOut)} />
              <KV label={t('cash.xreport.expected')} value={fmt(x.expectedCash)} strong />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </div>
  );
}

function SafeTab({ fmt }: { fmt: Fmt }) {
  const { t } = useTranslation('common');
  const create = useCreateCashMovement();
  const { register, handleSubmit, reset } = useForm<{ type: string; amount: number; reason: string }>({
    defaultValues: { type: 'SAFE_DROP' },
  });
  const onSubmit = (d: { type: string; amount: number; reason: string }) =>
    create.mutate({ ...d, amount: Number(d.amount) }, { onSuccess: () => reset({ type: d.type }) });
  return (
    <Card>
      <CardHeader><CardTitle>{t('cash.safe.title')}</CardTitle></CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-slate-500">{t('cash.safe.desc')}</p>
        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
          <select {...register('type')} className="rounded-md border-slate-300 text-sm">
            <option value="SAFE_DROP">{t('cash.safe.typeSafeDrop')}</option>
            <option value="BANK_DEPOSIT">{t('cash.safe.typeBankDeposit')}</option>
            <option value="PETTY_CASH">{t('cash.safe.typePettyCash')}</option>
            <option value="CASH_OUT">{t('cash.safe.typeCashOut')}</option>
          </select>
          <input {...register('amount', { required: true, valueAsNumber: true })} type="number" step="0.01" placeholder={t('cash.safe.amount')} className="rounded-md border-slate-300 text-sm" />
          <input {...register('reason')} placeholder={t('cash.safe.reason')} className="rounded-md border-slate-300 text-sm" />
          <button type="submit" disabled={create.isPending} className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {create.isPending ? t('cash.safe.saving') : t('cash.safe.save')}
          </button>
        </form>
        {create.isSuccess && <p className="mt-3 text-sm text-emerald-600">{t('cash.safe.saved', { amount: fmt(create.data?.amount ?? 0) })}</p>}
        {create.isError && <p className="mt-3 text-sm text-rose-600">{t('cash.safe.failed')}</p>}
      </CardContent>
    </Card>
  );
}

function TipsTab({ fmt }: { fmt: Fmt }) {
  const { t } = useTranslation('common');
  const today = format(new Date(), 'yyyy-MM-dd');
  const [range] = useState({ startDate: format(subDays(new Date(), 7), 'yyyy-MM-dd'), endDate: today });
  const { data, isLoading, isError } = useTipDistribution(range);
  if (isLoading) return <Loading />;
  // The tab is now hidden entirely without advancedReports (filtered out of
  // `tabs` in CashPage), so a 403 here would mean a state drift bug, not a
  // plan-upsell moment — no fabricated pool, just an honest retry message.
  if (isError)
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-amber-700">
          {t('cash.tips.error')}
        </CardContent>
      </Card>
    );
  return (
    <Card>
      <CardHeader><CardTitle>{t('cash.tips.title', { pool: fmt(data?.pool ?? 0), hours: data?.totalHours ?? 0 })}</CardTitle></CardHeader>
      <CardContent>
        <Table head={[t('cash.tips.staff'), t('cash.tips.hours'), t('cash.tips.share')]}
          rows={(data?.distribution ?? []).map((d: any) => [d.staffName, String(d.hours), fmt(d.tipShare)])} />
        {data?.undistributed > 0 && <p className="mt-3 text-xs text-amber-600">{t('cash.tips.undistributed', { amount: fmt(data.undistributed) })}</p>}
      </CardContent>
    </Card>
  );
}

function Loading() {
  const { t } = useTranslation('common');
  return <div className="py-12 text-center text-slate-400">{t('cash.loading')}</div>;
}
function Empty({ text }: { text: string }) { return <div className="py-8 text-center text-slate-400">{text}</div>; }
function KV({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div><p className="text-slate-500">{label}</p><p className={`tabular-nums ${strong ? 'text-lg font-bold' : 'font-semibold'}`}>{value}</p></div>;
}
function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  const { t } = useTranslation('common');
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-slate-500">{head.map((h) => <th key={h} className="py-2 pr-4">{h}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={head.length} className="py-6 text-center text-slate-400">{t('cash.empty')}</td></tr>
          : rows.map((r, i) => <tr key={i} className="border-t border-slate-100">{r.map((c, j) => <td key={j} className="py-2 pr-4 tabular-nums">{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}
