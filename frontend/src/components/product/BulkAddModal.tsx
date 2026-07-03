import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Trash2, Loader2 } from "lucide-react";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import {
  useCategories,
  useCommitMenuImport,
} from "../../features/menu/menuApi";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

interface Row {
  name: string;
  price: string;
  categoryId: string;
}

const emptyRow = (categoryId = ""): Row => ({
  name: "",
  price: "",
  categoryId,
});

/**
 * Bulk-add many products at once: a small grid of name / price / category rows.
 * Rows are grouped by category and committed via the (non-AI-gated) menu-import
 * commit endpoint, which matches categories by name and batch-creates products.
 */
export default function BulkAddModal({ isOpen, onClose }: Props) {
  const { t } = useTranslation(["menu", "common"]);
  const { data: categories } = useCategories();
  const commit = useCommitMenuImport();
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [failures, setFailures] = useState<
    { category: string; product: string; reason: string }[]
  >([]);

  const firstCategory = categories?.[0]?.id ?? "";

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, emptyRow(firstCategory)]);
  const removeRow = (i: number) =>
    setRows((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs));

  const reset = () => {
    setRows([emptyRow(), emptyRow(), emptyRow()]);
    setFailures([]);
  };

  const isFilled = (r: Row) =>
    r.name.trim() !== "" || r.price !== "" || !!r.categoryId;
  const isValid = (r: Row) =>
    r.name.trim() !== "" &&
    !!r.categoryId &&
    r.price !== "" &&
    Number(r.price) >= 0;

  const submit = async () => {
    setFailures([]);
    const touched = rows.filter(isFilled);
    const valid = rows.filter(isValid);

    if (valid.length === 0) {
      toast.error(
        t(
          "menu.bulk.needRows",
          "En az bir ürün için ad, fiyat ve kategori girin.",
        ),
      );
      return;
    }
    // Rows with partial input but a missing/invalid field: don't drop them
    // silently — make the operator complete or clear them first.
    if (touched.length > valid.length) {
      toast.error(
        t(
          "menu.bulk.incompleteRows",
          "Bazı satırlarda ad, fiyat veya kategori eksik. Tamamlayın veya silin.",
        ),
      );
      return;
    }

    // Group by the selected category's NAME (commit matches categories by name).
    const byCategory = new Map<string, { name: string; price: number }[]>();
    for (const r of valid) {
      const cat = categories?.find((c) => c.id === r.categoryId);
      if (!cat) continue;
      const list = byCategory.get(cat.name) ?? [];
      list.push({ name: r.name.trim(), price: Number(r.price) });
      byCategory.set(cat.name, list);
    }
    if (byCategory.size === 0) {
      toast.error(
        t(
          "menu.bulk.noValidCategory",
          "Seçili kategoriler artık geçerli değil — sayfayı yenileyin.",
        ),
      );
      return;
    }

    try {
      const summary = await commit.mutateAsync({
        categories: [...byCategory.entries()].map(([name, products]) => ({
          name,
          products,
        })),
      });
      // Only clear + close on a clean full success.
      if (summary.productsCreated > 0 && summary.failures.length === 0) {
        toast.success(
          t("menu.bulk.done", "{{ok}} ürün eklendi.", {
            ok: summary.productsCreated,
          }),
        );
        reset();
        onClose();
        return;
      }
      // Partial or nothing: keep the modal open, surface each failure's reason,
      // and retain only the rows that failed so they can be fixed + retried.
      setFailures(summary.failures);
      const failedKeys = new Set(
        summary.failures.map((f) => `${f.category}||${f.product}`),
      );
      const keptRows = valid.filter((r) => {
        const cat = categories?.find((c) => c.id === r.categoryId);
        return cat && failedKeys.has(`${cat.name}||${r.name.trim()}`);
      });
      setRows(keptRows.length > 0 ? keptRows : valid);
      if (summary.productsCreated > 0) {
        toast.warning(
          t("menu.bulk.partial", "{{ok}} ürün eklendi, {{fail}} başarısız.", {
            ok: summary.productsCreated,
            fail: summary.failures.length,
          }),
        );
      } else {
        toast.error(t("menu.bulk.noneCreated", "Hiç ürün eklenemedi."));
      }
    } catch {
      // useCommitMenuImport's onError already toasts the API message (incl. the
      // plan-limit reason); keep the modal + rows so the operator can retry.
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("menu.bulk.title", "Toplu ürün ekle")}
      size="xl"
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-500">
          {t(
            "menu.bulk.subtitle",
            "Birden çok ürünü tek seferde ekleyin. Her satır için ad, fiyat ve kategori girin.",
          )}
        </p>

        {/* Header row */}
        <div className="hidden grid-cols-[1fr_100px_150px_32px] gap-2 px-1 text-xs font-medium text-slate-500 sm:grid">
          <span>{t("menu.itemName", "Ürün adı")}</span>
          <span>{t("menu.price", "Fiyat")}</span>
          <span>{t("menu.category", "Kategori")}</span>
          <span />
        </div>

        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {rows.map((row, i) => (
            <div
              key={i}
              className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_100px_150px_32px] sm:items-center"
            >
              <input
                value={row.name}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder={t("menu.itemName", "Ürün adı") as string}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
              <input
                value={row.price}
                onChange={(e) => update(i, { price: e.target.value })}
                type="number"
                step="0.01"
                min="0"
                placeholder="₺"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
              <select
                value={row.categoryId}
                onChange={(e) => update(i, { categoryId: e.target.value })}
                className="rounded-md border border-slate-300 px-2 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="">
                  {t("menu.selectCategory", "Kategori seçin")}
                </option>
                {categories?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="justify-self-end rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                aria-label={t("common:app.delete", "Sil") as string}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <Button variant="ghost" size="sm" onClick={addRow}>
          <Plus className="mr-1 h-4 w-4" />
          {t("menu.bulk.addRow", "Satır ekle")}
        </Button>

        {failures.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            <p className="mb-1 font-medium">
              {t("menu.bulk.failedTitle", "Eklenemeyen ürünler")}
            </p>
            <ul className="space-y-0.5">
              {failures.map((f, i) => (
                <li key={i}>
                  • {f.product}: {f.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-3 border-t border-slate-100 pt-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onClose}
            disabled={commit.isPending}
          >
            {t("common:app.cancel", "İptal")}
          </Button>
          <Button
            className="flex-1"
            onClick={submit}
            disabled={commit.isPending}
          >
            {commit.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {t("menu.bulk.submit", "Tümünü ekle")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
