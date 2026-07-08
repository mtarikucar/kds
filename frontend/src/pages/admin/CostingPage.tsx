import { useState } from 'react';
import { format, subDays } from 'date-fns';
import { ChefHat, Scale, Layers } from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '../../components/ui/Card';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import {
  useMenuEngineering,
  useUsageVariance,
} from '../../features/stock-management/costingApi';
import { useRecipes } from '../../features/stock-management/stockManagementApi';

type Tab = 'menu' | 'variance' | 'recipes';

const CLASS_TONE: Record<string, string> = {
  STAR: 'bg-emerald-100 text-emerald-700',
  PLOWHORSE: 'bg-sky-100 text-sky-700',
  PUZZLE: 'bg-amber-100 text-amber-700',
  DOG: 'bg-rose-100 text-rose-700',
};

export default function CostingPage() {
  const fmt = useFormatCurrency();
  const [tab, setTab] = useState<Tab>('menu');
  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'menu', label: 'Menü Mühendisliği', icon: ChefHat },
    { id: 'variance', label: 'Kullanım Varyansı', icon: Scale },
    { id: 'recipes', label: 'Reçete Maliyetleri', icon: Layers },
  ];
  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reçete & Maliyet</h1>
        <p className="text-sm text-slate-500">Menü mühendisliği (Star/Plowhorse/Puzzle/Dog), teorik-fiili varyans ve reçete başı maliyet.</p>
      </div>
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
      {tab === 'menu' && <MenuTab fmt={fmt} />}
      {tab === 'variance' && <VarianceTab fmt={fmt} />}
      {tab === 'recipes' && <RecipesTab fmt={fmt} />}
    </div>
  );
}

type Fmt = (n: number) => string;

function MenuTab({ fmt }: { fmt: Fmt }) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [range] = useState({ startDate: format(subDays(new Date(), 30), 'yyyy-MM-dd'), endDate: today });
  const { data, isLoading } = useMenuEngineering(range);
  if (isLoading) return <Loading />;
  const items: any[] = data?.items ?? data ?? [];
  return (
    <Card>
      <CardHeader><CardTitle>Menü mühendisliği (son 30 gün)</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500">
              <th className="py-2 pr-4">Ürün</th><th>Adet</th><th>Maliyet</th><th>Fiyat</th><th>Marj</th><th>Sınıf</th>
            </tr></thead>
            <tbody>
              {items.length === 0 ? <tr><td colSpan={6} className="py-6 text-center text-slate-400">Kayıt yok.</td></tr>
              : items.map((it: any, i: number) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-2 pr-4">{it.productName ?? it.name}</td>
                  <td className="tabular-nums">{it.quantitySold ?? it.unitsSold ?? '—'}</td>
                  <td className="tabular-nums">{it.cost != null ? fmt(it.cost) : '—'}</td>
                  <td className="tabular-nums">{it.price != null ? fmt(it.price) : '—'}</td>
                  <td className="tabular-nums">{it.margin != null ? fmt(it.margin) : '—'}</td>
                  <td>{it.classification && <span className={`rounded-full px-2 py-0.5 text-xs ${CLASS_TONE[it.classification] ?? 'bg-slate-100'}`}>{it.classification}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function VarianceTab({ fmt }: { fmt: Fmt }) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [range] = useState({ startDate: format(subDays(new Date(), 30), 'yyyy-MM-dd'), endDate: today });
  const { data, isLoading } = useUsageVariance(range);
  if (isLoading) return <Loading />;
  const rows: any[] = data?.items ?? data ?? [];
  return (
    <Card>
      <CardHeader><CardTitle>Teorik vs fiili kullanım varyansı</CardTitle></CardHeader>
      <CardContent>
        <Table head={['Kalem', 'Teorik', 'Fiili/Sayım', 'Varyans', 'Maliyet etkisi']}
          rows={rows.map((r: any) => [
            r.name ?? r.stockItemName,
            String(r.theoretical ?? r.expected ?? '—'),
            String(r.actual ?? r.counted ?? '—'),
            String(r.variance ?? '—'),
            r.varianceCost != null ? fmt(r.varianceCost) : '—',
          ])} />
      </CardContent>
    </Card>
  );
}

function RecipesTab({ fmt }: { fmt: Fmt }) {
  const { data, isLoading } = useRecipes();
  if (isLoading) return <Loading />;
  const recipes: any[] = (data as any) ?? [];
  return (
    <Card>
      <CardHeader><CardTitle>Reçete başı maliyet</CardTitle></CardHeader>
      <CardContent>
        <Table head={['Reçete', 'Porsiyon maliyeti', 'Food-cost %', 'Brüt marj']}
          rows={recipes.map((r: any) => [
            r.name ?? r.product?.name ?? '—',
            r.costing?.costPerPortion != null ? fmt(r.costing.costPerPortion) : '—',
            r.costing?.foodCostPct != null ? `%${r.costing.foodCostPct}` : '—',
            r.costing?.grossMargin != null ? fmt(r.costing.grossMargin) : '—',
          ])} />
      </CardContent>
    </Card>
  );
}

function Loading() { return <div className="py-12 text-center text-slate-400">Yükleniyor…</div>; }
function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-slate-500">{head.map((h) => <th key={h} className="py-2 pr-4">{h}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={head.length} className="py-6 text-center text-slate-400">Kayıt yok.</td></tr>
          : rows.map((r, i) => <tr key={i} className="border-t border-slate-100">{r.map((c, j) => <td key={j} className="py-2 pr-4 tabular-nums">{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}
