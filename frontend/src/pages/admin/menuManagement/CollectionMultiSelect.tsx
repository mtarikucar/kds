import { useState } from "react";
import { Plus } from "lucide-react";
import { useCollections, useCreateCollection } from "../../../features/menu/menuApi";

/**
 * Multi-select of menu collections with an inline "create new" quick-add.
 * Controlled — the ProductEditor owns the selected id array.
 */
export default function CollectionMultiSelect({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const { data: collections } = useCollections();
  const { mutateAsync: createCollection, isPending } = useCreateCollection();
  const [newName, setNewName] = useState("");

  const toggle = (id: string) =>
    onChange(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    );

  const addNew = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const created = await createCollection({ name });
      setNewName("");
      if (created?.id) onChange([...selected, created.id]);
    } catch {
      /* toast surfaced by the mutation */
    }
  };

  return (
    <div className="space-y-3">
      <p className="-mt-1 text-xs text-slate-500">
        Koleksiyonlar kategoriden bağımsızdır — ürün birden çok koleksiyonda yer
        alabilir ("Kampanyalar", "Menüler", "Yeni"). QR menüde şerit olarak
        görünür.
      </p>

      {(collections ?? []).length === 0 ? (
        <p className="text-sm text-slate-500">Henüz koleksiyon yok.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {collections!.map((c) => {
            const on = selected.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  on
                    ? "border-primary-500 bg-primary-50 text-primary-700"
                    : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"
                }`}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          placeholder="Yeni koleksiyon adı"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void addNew();
            }
          }}
        />
        <button
          type="button"
          onClick={() => void addNew()}
          disabled={isPending || !newName.trim()}
          className="flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Ekle
        </button>
      </div>
    </div>
  );
}
