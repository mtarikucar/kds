import { useState } from "react";
import { Plus, Trash2, Check, X, Pencil } from "lucide-react";
import {
  useCollections,
  useCreateCollection,
  useUpdateCollection,
  useDeleteCollection,
} from "../../../features/menu/menuApi";
import Button from "../../../components/ui/Button";

/**
 * Menu-collections manager (classification, kategoriden bağımsız). Create /
 * rename / activate / delete. Product→collection assignment lives in the
 * product editor (CollectionMultiSelect); this tab manages the collections
 * themselves. Deleting a collection only un-classifies its products.
 */
export default function CollectionsTab() {
  const { data: collections, isLoading } = useCollections();
  const { mutateAsync: create, isPending: creating } = useCreateCollection();
  const { mutateAsync: update } = useUpdateCollection();
  const { mutateAsync: remove } = useDeleteCollection();

  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    await create({ name });
    setNewName("");
  };

  const saveEdit = async (id: string) => {
    const name = editName.trim();
    if (name) await update({ id, data: { name } });
    setEditId(null);
  };

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-slate-500">
        Koleksiyonlar kategoriden bağımsız gruplardır ("Kampanyalar", "Menüler",
        "Yeni"). Ürünler birden çok koleksiyonda olabilir ve QR menüde şerit
        olarak görünür. Ürünleri koleksiyona ürün düzenleme ekranından
        atarsınız.
      </p>

      <div className="flex items-center gap-2">
        <input
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Yeni koleksiyon adı"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
        />
        <Button size="sm" onClick={() => void add()} disabled={creating || !newName.trim()}>
          <Plus className="mr-1 h-4 w-4" /> Ekle
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">Yükleniyor…</p>
      ) : (collections ?? []).length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 py-8 text-center text-sm text-slate-500">
          Henüz koleksiyon yok.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {collections!.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-3 py-2.5">
              {editId === c.id ? (
                <>
                  <input
                    className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    value={editName}
                    autoFocus
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveEdit(c.id);
                      if (e.key === "Escape") setEditId(null);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void saveEdit(c.id)}
                    className="rounded p-1.5 text-green-600 hover:bg-green-50"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditId(null)}
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <>
                  <div className="flex-1">
                    <span className="text-sm font-medium text-slate-800">
                      {c.name}
                    </span>
                    <span className="ml-2 text-xs text-slate-400">
                      {c.productCount ?? 0} ürün · /{c.slug}
                    </span>
                  </div>
                  <label className="flex items-center gap-1 text-xs text-slate-500">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={c.isActive !== false}
                      onChange={(e) =>
                        void update({
                          id: c.id,
                          data: { isActive: e.target.checked },
                        })
                      }
                    />
                    Aktif
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setEditId(c.id);
                      setEditName(c.name);
                    }}
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          `"${c.name}" koleksiyonu silinsin mi? Ürünler silinmez, sadece bu gruptan çıkar.`,
                        )
                      )
                        void remove(c.id);
                    }}
                    className="rounded p-1.5 text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
