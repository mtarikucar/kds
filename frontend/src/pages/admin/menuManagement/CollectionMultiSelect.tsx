import { useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  useCollections,
  useCreateCollection,
  useUpdateCollection,
  useDeleteCollection,
} from "../../../features/menu/menuApi";

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
  const { mutateAsync: updateCollection } = useUpdateCollection();
  const { mutateAsync: deleteCollection } = useDeleteCollection();
  const [newName, setNewName] = useState("");
  // Renaming and deleting used to need the retired Koleksiyonlar tab. They are
  // rare next to "tick this product into a collection", so they hide behind a
  // toggle rather than putting two icons on every chip.
  const [managing, setManaging] = useState(false);
  // Latest selection for the post-create append: two in-flight creates would
  // otherwise both spread the same stale `selected` and clobber each other.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const toggle = (id: string) =>
    onChange(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    );

  const addNew = async () => {
    const name = newName.trim();
    // `isPending` guard: the button is disabled while pending, but the Enter
    // handler isn't — two quick Enters would create the collection twice.
    if (!name || isPending) return;
    try {
      const created = await createCollection({ name });
      setNewName("");
      if (created?.id) onChange([...selectedRef.current, created.id]);
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
        <div className="flex flex-wrap items-center gap-2">
          {collections!.map((c) => {
            const on = selected.includes(c.id);
            return (
              <span
                key={c.id}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors ${
                  on
                    ? "border-primary-500 bg-primary-50 text-primary-700"
                    : "border-slate-300 bg-white text-slate-600"
                }`}
              >
                <button type="button" onClick={() => toggle(c.id)}>
                  {c.name}
                </button>
                {managing && (
                  <>
                    <button
                      type="button"
                      title="Yeniden adlandır"
                      onClick={async () => {
                        const name = prompt("Koleksiyon adı", c.name)?.trim();
                        if (name && name !== c.name) {
                          await updateCollection({ id: c.id, data: { name } });
                        }
                      }}
                      className="text-slate-400 hover:text-slate-700"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      title="Sil"
                      onClick={async () => {
                        if (!confirm(`"${c.name}" koleksiyonu silinsin mi? Ürünler silinmez, yalnız bu gruptan çıkar.`))
                          return;
                        await deleteCollection(c.id);
                        onChange(selectedRef.current.filter((id) => id !== c.id));
                      }}
                      className="text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </>
                )}
              </span>
            );
          })}
          <button
            type="button"
            onClick={() => setManaging((m) => !m)}
            className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-700"
          >
            {managing ? "Bitti" : "Düzenle"}
          </button>
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
