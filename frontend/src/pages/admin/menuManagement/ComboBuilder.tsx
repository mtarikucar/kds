import { Plus, Trash2 } from "lucide-react";
import Button from "../../../components/ui/Button";
import type { ComboGroupInput } from "../../../types";

type ComponentOption = { id: string; name: string; price: number };

/**
 * Inline combo builder: an array of slots ("groups"), each with min/max
 * selection and a list of selectable component products (quantity, priceDelta,
 * default). Controlled — holds no state of its own; the ProductEditor owns the
 * `comboGroups` array. Mirrors the modifier-group editing pattern.
 */
export default function ComboBuilder({
  groups,
  onChange,
  components,
}: {
  groups: ComboGroupInput[];
  onChange: (groups: ComboGroupInput[]) => void;
  components: ComponentOption[];
}) {
  const patchGroup = (gi: number, patch: Partial<ComboGroupInput>) =>
    onChange(groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)));

  const patchItem = (
    gi: number,
    ii: number,
    patch: Partial<ComboGroupInput["items"][number]>,
  ) =>
    patchGroup(gi, {
      items: groups[gi].items.map((it, i) =>
        i === ii ? { ...it, ...patch } : it,
      ),
    });

  const addGroup = () =>
    onChange([
      ...groups,
      {
        name: "",
        minSelect: 1,
        maxSelect: 1,
        items: [],
      },
    ]);

  const addItem = (gi: number) =>
    patchGroup(gi, {
      items: [
        ...groups[gi].items,
        {
          componentProductId: components[0]?.id ?? "",
          quantity: 1,
          priceDelta: 0,
          isDefault: groups[gi].items.length === 0,
        },
      ],
    });

  return (
    <div className="space-y-4">
      <p className="-mt-1 text-xs text-slate-500">
        Her "slot" bir seçim grubudur. Sabit içerik için tek seçenekli slot +
        "varsayılan" işaretleyin; "içeceğini seç" gibi seçimli slotlarda birden
        çok seçenek ekleyin. Kombo fiyatı üstteki fiyat alanıdır; slot
        seçenekleri ± fark ekleyebilir.
      </p>

      {groups.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 py-6 text-center text-sm text-slate-500">
          Henüz slot eklenmedi. "Slot ekle" ile başlayın.
        </p>
      )}

      {groups.map((group, gi) => (
        <div
          key={gi}
          className="rounded-xl border border-slate-200 bg-slate-50 p-3"
        >
          <div className="mb-2 flex items-center gap-2">
            <input
              className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              placeholder="Slot adı (ör. İçeceğini Seç)"
              value={group.name}
              onChange={(e) => patchGroup(gi, { name: e.target.value })}
            />
            <button
              type="button"
              onClick={() => onChange(groups.filter((_, i) => i !== gi))}
              className="rounded-md p-1.5 text-red-600 hover:bg-red-50"
              title="Slotu sil"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          <div className="mb-2 flex items-center gap-3 text-xs text-slate-600">
            <label className="flex items-center gap-1">
              En az
              <input
                type="number"
                min={0}
                max={20}
                className="w-14 rounded border border-slate-300 px-1.5 py-1"
                value={group.minSelect ?? 1}
                onChange={(e) =>
                  patchGroup(gi, { minSelect: Number(e.target.value) })
                }
              />
            </label>
            <label className="flex items-center gap-1">
              En çok
              <input
                type="number"
                min={1}
                max={20}
                className="w-14 rounded border border-slate-300 px-1.5 py-1"
                value={group.maxSelect ?? 1}
                onChange={(e) =>
                  patchGroup(gi, { maxSelect: Number(e.target.value) })
                }
              />
            </label>
          </div>

          <div className="space-y-2">
            {group.items.map((item, ii) => (
              <div
                key={ii}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2"
              >
                <select
                  className="min-w-[9rem] flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  value={item.componentProductId}
                  onChange={(e) =>
                    patchItem(gi, ii, { componentProductId: e.target.value })
                  }
                >
                  <option value="">Ürün seç…</option>
                  {components.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-xs text-slate-600">
                  Adet
                  <input
                    type="number"
                    min={1}
                    max={50}
                    className="w-14 rounded border border-slate-300 px-1.5 py-1"
                    value={item.quantity ?? 1}
                    onChange={(e) =>
                      patchItem(gi, ii, { quantity: Number(e.target.value) })
                    }
                  />
                </label>
                <label className="flex items-center gap-1 text-xs text-slate-600">
                  Fark ₺
                  <input
                    type="number"
                    step="0.01"
                    className="w-20 rounded border border-slate-300 px-1.5 py-1"
                    value={item.priceDelta ?? 0}
                    onChange={(e) =>
                      patchItem(gi, ii, { priceDelta: Number(e.target.value) })
                    }
                  />
                </label>
                <label className="flex items-center gap-1 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={!!item.isDefault}
                    onChange={(e) =>
                      patchItem(gi, ii, { isDefault: e.target.checked })
                    }
                  />
                  Varsayılan
                </label>
                <button
                  type="button"
                  onClick={() =>
                    patchGroup(gi, {
                      items: group.items.filter((_, i) => i !== ii),
                    })
                  }
                  className="rounded-md p-1.5 text-red-600 hover:bg-red-50"
                  title="Seçeneği sil"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => addItem(gi)}
            className="mt-2 flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
          >
            <Plus className="h-3.5 w-3.5" /> Seçenek ekle
          </button>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={addGroup}>
        <Plus className="mr-1 h-4 w-4" /> Slot ekle
      </Button>
    </div>
  );
}
