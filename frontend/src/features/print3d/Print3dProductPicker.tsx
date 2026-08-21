import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageOff } from 'lucide-react';
import type { Product } from '../../types';
import { useFormatCurrencyExtended } from '../../hooks/useFormatCurrency';
import { computePrint3dTotalCents } from './print3dSkus';

/**
 * Sihirbaz adım 1 — menü ürünü çoklu seçimi.
 *
 * Seçim durumu DIŞARIDA (`selected: string[]` + `onChange`) yaşar; sihirbaz
 * onu adımlar arasında taşır ve doğrudan sepet satırına yazar. Bileşenin
 * kendi içinde tuttuğu tek durum arama kutusu ve kategori süzgecidir.
 *
 * Arama İSTEMCİ TARAFINDA: ProductFilters.search sunucuda hiç okunmuyor,
 * yani `useProducts({ search })` çağırmak sessizce filtresiz liste döndürür.
 *
 * `maxSelection` burada gerçek para sınırıdır (sunucunun kendi tavanı,
 * bkz. plan Global Constraints — min 1, maks 50 ürün). Tavan dolduğunda
 * seçilmemiş her kart disabled olur; ZATEN seçili kartlar yine de
 * çıkarılabilir kalır (tavan EKLEMEYİ engeller, mevcut 50'yi düzenlemeyi
 * değil). Sunucu bunu zaten uyguluyor (PRINT3D_TOO_MANY_PRODUCTS); burada
 * tekrar uygulamak, müşterinin ödemeye giderken "geçersiz sepet" hatasıyla
 * karşılaşmasını önlüyor.
 *
 * Bu bileşenin kendi "Devam et" düğmesi YOK — sihirbaz kabuğu (ayrı görev)
 * `selected.length`'i [minItems, maxItems] aralığında tutarak kendi Next
 * düğmesini kilitler. Burada garanti edilen şey o kapıya giden sinyalin
 * DOĞRU olması: `selected` her zaman gerçek seçimi yansıtır, 0 iken sayaç
 * 0 gösterir ve `onChange` kendiliğinden bir seçim uydurmaz.
 *
 * Para formatlama: storeApi'nin sabit tr-TR `formatMoney`'i YERİNE
 * `useFormatCurrencyExtended` (ülke-profili sürücülü) kullanılıyor — v3.7.0
 * money/date gösterimini ülke profiline bağladı ve Görev 14/15 aynı
 * düzeltmeyi Print3dStoreCard'da zaten yapmak zorunda kalmıştı.
 */
export default function Print3dProductPicker({
  products,
  selected,
  onChange,
  maxSelection,
  basePriceCents,
  perItemCents,
  currency,
}: {
  products: Product[];
  selected: string[];
  onChange: (ids: string[]) => void;
  maxSelection: number;
  basePriceCents: number;
  perItemCents: number;
  currency: string;
}) {
  const { t } = useTranslation('hardware');
  const { formatWithCurrency } = useFormatCurrencyExtended();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');

  const categories = useMemo(() => {
    const byId = new Map<string, string>();
    for (const p of products) {
      if (p.category?.id) byId.set(p.category.id, p.category.name);
    }
    return [...byId.entries()].map(([id, name]) => ({ id, name }));
  }, [products]);

  const visible = useMemo(() => {
    // Türkçe küçültme: "İÇECEKLER".toLowerCase() İngilizce kurallarıyla
    // eşleşmez, bu yüzden tr-TR yerel ayarı verilir.
    const needle = search.toLocaleLowerCase('tr-TR').trim();
    return products.filter(
      (p) =>
        (!categoryId || p.category?.id === categoryId) &&
        (!needle || p.name.toLocaleLowerCase('tr-TR').includes(needle)),
    );
  }, [products, search, categoryId]);

  const selectedSet = new Set(selected);
  const atCap = selected.length >= maxSelection;

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(selected.filter((x) => x !== id));
      return;
    }
    if (atCap) return; // tavan dolu — sessiz no-op, düğme zaten disabled
    onChange([...selected, id]);
  };

  const totalCents = computePrint3dTotalCents(selected.length, basePriceCents, perItemCents);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="min-w-48 flex-1 rounded border px-3 py-1.5 text-sm"
          placeholder={t('print3d.picker.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label={t('print3d.picker.allCategories')}
          className="rounded border px-2 py-1.5 text-sm"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">{t('print3d.picker.allCategories')}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {products.length === 0 ? (
        <p className="rounded border border-dashed p-8 text-center text-sm text-gray-500">
          {t('print3d.picker.empty')}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {visible.map((p) => {
            const picked = selectedSet.has(p.id);
            const thumb = p.images?.[0]?.url ?? p.image ?? null;
            return (
              <button
                key={p.id}
                type="button"
                data-testid={`print3d-pick-${p.id}`}
                aria-pressed={picked}
                disabled={!picked && atCap}
                onClick={() => toggle(p.id)}
                className={`overflow-hidden rounded-lg border text-left transition ${
                  picked ? 'border-violet-500 ring-2 ring-violet-200' : 'border-gray-200'
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {thumb ? (
                  <img src={thumb} alt={p.name} className="aspect-[4/3] w-full object-cover" />
                ) : (
                  <div className="flex aspect-[4/3] w-full items-center justify-center bg-slate-100 text-slate-300">
                    <ImageOff className="h-6 w-6" aria-hidden="true" />
                  </div>
                )}
                <div className="p-2">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-gray-500">{formatWithCurrency(p.price, currency)}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded border bg-gray-50 p-3">
        <span data-testid="print3d-selected-count" className="text-sm text-gray-700">
          {t('print3d.picker.selectedCount', { count: selected.length })}
          {atCap && (
            <span className="ml-2 text-xs text-amber-700">
              {t('print3d.picker.maxReached', { max: maxSelection })}
            </span>
          )}
        </span>
        <span className="text-sm">
          <span className="text-gray-500">{t('print3d.picker.livePrice')}: </span>
          <strong data-testid="print3d-live-total">{formatWithCurrency(totalCents / 100, currency)}</strong>
        </span>
      </div>
    </div>
  );
}
