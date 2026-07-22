import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShoppingCart, TrendingUp, TrendingDown, Compass, ChevronDown } from 'lucide-react';
import { useGuidance, type GuidanceSource, type VolumeTier, type BuyListItem } from '../../../features/stock-management/guidanceApi';
import { useCreatePurchaseOrder } from '../../../features/stock-management/stockManagementApi';
import { useFormatCurrency } from '../../../hooks/useFormatCurrency';
import { Card, CardContent } from '../../../components/ui/Card';

const priceOf = (s: GuidanceSource): number | null =>
  s.type === 'OWN_HISTORY' ? s.lastUnitPrice : s.type === 'CATALOG' ? s.unitPrice : null;
const supplierIdOf = (s: GuidanceSource): string | null =>
  s.type === 'CHANNEL' ? null : s.supplierId;
const supplierNameOf = (s: GuidanceSource): string | null =>
  s.type === 'CHANNEL' ? null : s.supplierName;

export default function GuidanceTab() {
  const { t } = useTranslation('stock');
  const formatCurrency = useFormatCurrency();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useGuidance();
  const createPO = useCreatePurchaseOrder();
  const [tierView, setTierView] = useState<VolumeTier | null>(null);

  const tier = tierView ?? data?.volumeTier ?? 'SMALL_CAFE';

  // Group buy-list rows by recommended supplier (channel-only rows go ungrouped).
  const groups = useMemo(() => {
    const m = new Map<string, { supplierId: string; supplierName: string; rows: BuyListItem[] }>();
    const loose: BuyListItem[] = [];
    for (const row of data?.buyList ?? []) {
      const sid = supplierIdOf(row.recommended);
      const sname = supplierNameOf(row.recommended);
      if (sid && sname) {
        if (!m.has(sid)) m.set(sid, { supplierId: sid, supplierName: sname, rows: [] });
        m.get(sid)!.rows.push(row);
      } else loose.push(row);
    }
    return { grouped: [...m.values()], loose };
  }, [data]);

  if (isError) return <p data-testid="guidance-error" className="text-sm text-slate-400 py-6">{t('guide.error', 'Rehber yüklenemedi')}</p>;

  const createDraft = (supplierId: string, rows: BuyListItem[]) => {
    createPO.mutate(
      {
        supplierId,
        items: rows.map((r) => ({
          stockItemId: r.stockItemId,
          quantityOrdered: r.suggestedQty,
          unitPrice: priceOf(r.recommended) ?? 0,
        })),
      },
      {
        onSuccess: () => {
          navigate('/admin/stock?tab=orders', { replace: true });
        },
      },
    );
  };

  const whyLine = (s: GuidanceSource): string => {
    if (s.type === 'OWN_HISTORY') {
      return t('guide.cheapestRecent', { count: s.receiptCount, defaultValue: `son ${s.receiptCount} alımda en ucuz` });
    }
    if (s.type === 'CATALOG') return t('guide.catalogPrice', 'katalog fiyatı');
    return t(s.recommendationKey, t('guide.rec.generic', 'kanal rehberine göre önerilir'));
  };

  return (
    <div className="space-y-8">
      {/* Buy list */}
      <section>
        <h2 className="text-lg font-heading font-semibold text-slate-900 mb-3">{t('guide.buyNow', 'Bugün alınması gerekenler')}</h2>
        {isLoading ? (
          <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
        ) : (data?.buyList.length ?? 0) === 0 ? (
          <p data-testid="buylist-empty" className="text-sm text-slate-500 py-4">{t('guide.buyListEmpty', 'Par altında malzeme yok 🎉')}</p>
        ) : (
          <div className="space-y-4">
            {groups.grouped.map((g) => {
              const total = g.rows.reduce((s, r) => s + (priceOf(r.recommended) ?? 0) * r.suggestedQty, 0);
              return (
                <Card key={g.supplierId}>
                  <CardContent className="py-4">
                    <ul className="space-y-2">
                      {g.rows.map((r) => {
                        const p = priceOf(r.recommended);
                        const alt = r.alternatives?.[0];
                        const altPrice = alt ? priceOf(alt) : null;
                        const altName = alt ? supplierNameOf(alt) : null;
                        return (
                          <li key={r.stockItemId} className="flex items-center gap-3 text-sm">
                            <span className="flex-1 truncate text-slate-800">{r.name}</span>
                            <span className="tabular-nums text-slate-500">{r.suggestedQty} {r.unit}</span>
                            <span className="tabular-nums font-semibold text-slate-900">{p != null ? `${formatCurrency(p)}/${r.unit}` : '—'}</span>
                            <span className="hidden sm:flex items-center gap-1 text-xs text-slate-400 min-w-0">
                              {whyLine(r.recommended)}
                              {altPrice != null && altName && (
                                <span className="text-slate-300">
                                  {t('guide.alt', { name: altName, price: formatCurrency(altPrice) })}
                                </span>
                              )}
                              {r.recommended.type === 'OWN_HISTORY' && r.recommended.trendPct != null && (
                                r.recommended.trendPct >= 0
                                  ? <TrendingUp className="h-3 w-3 text-rose-500" />
                                  : <TrendingDown className="h-3 w-3 text-green-600" />
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-sm text-slate-600">{g.supplierName} · {g.rows.length} · ~{formatCurrency(total)}</span>
                      <button
                        data-testid={`draft-po-${g.supplierId}`}
                        onClick={() => createDraft(g.supplierId, g.rows)}
                        disabled={createPO.isPending}
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <ShoppingCart className="h-4 w-4" />
                        {t('guide.createDraft', 'Sipariş taslağı oluştur')}
                      </button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {groups.loose.length > 0 && (
              <Card>
                <CardContent className="py-4">
                  <ul className="space-y-2">
                    {groups.loose.map((r) => (
                      <li key={r.stockItemId} className="flex items-center gap-3 text-sm">
                        <span className="flex-1 truncate text-slate-800">{r.name}</span>
                        <span className="tabular-nums text-slate-500">{r.suggestedQty} {r.unit}</span>
                        <span className="flex items-center gap-1 text-xs text-slate-400"><Compass className="h-3 w-3" />{whyLine(r.recommended)}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </section>

      {/* Channel guide */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-heading font-semibold text-slate-900">{t('guide.channelGuide', 'Kanal rehberi')}</h2>
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs">
            {(['SMALL_CAFE', 'MID_RESTAURANT', 'MULTI_BRANCH'] as VolumeTier[]).map((tv) => (
              <button
                key={tv}
                onClick={() => setTierView(tv)}
                title={t('guide.viewAsTier', 'Şu ölçek için görüntüle')}
                className={`px-2.5 py-1 rounded-md ${tier === tv ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
              >
                {t(`guide.tier.${tv}`, tv)}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(data?.channelGuide ?? []).map((c) => <ChannelCard key={c.categoryKey} entry={c} tier={tier} />)}
        </div>
      </section>
    </div>
  );
}

function ChannelCard({ entry, tier }: { entry: { categoryKey: string; recommendationKey: string; detail: { channels: unknown[]; rules: string[] } }; tier: VolumeTier }) {
  const { t } = useTranslation('stock');
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="channel-card" className="rounded-xl border border-slate-200/60 bg-white p-4">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen((o) => !o)}>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">{t(`guide.cat.${entry.categoryKey}`, entry.categoryKey)}</div>
          <div className="text-sm text-slate-800 mt-0.5">{t(`guide.rec.${entry.categoryKey}.${tier}`, { defaultValue: t('guide.rec.generic', '') })}</div>
        </div>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul className="mt-3 space-y-1 text-xs text-slate-500">
          {entry.detail.rules.map((rk, i) => <li key={i}>• {t(rk, rk)}</li>)}
        </ul>
      )}
    </div>
  );
}
