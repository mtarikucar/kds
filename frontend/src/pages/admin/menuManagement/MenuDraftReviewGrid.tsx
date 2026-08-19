import { useTranslation } from "react-i18next";
import { Trash2, Plus, Loader2, CheckCircle2, AlertOctagon } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import type { ConflictPolicy } from "../../../features/menu/menuApi";
import type { MenuDraftControls } from "./useMenuDraft";

export const TAX_RATES = [0, 1, 10, 20];
export const cellCls =
  "w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500";

/**
 * The reviewable draft, for every source: photos, a link, a spreadsheet.
 * Purely presentational — all state lives in useMenuDraft, so a second
 * source needs no copy of this.
 *
 * Renders two distinct kinds of "this already exists" so an operator can't
 * mistake one for the other:
 *  - an ORDINARY conflict (amber ring): matched exactly one product. Has a
 *    SKIP / update price / add-anyway choice, settable in bulk.
 *  - an AMBIGUOUS row (red ring): matched more than one product — the
 *    already-doubled-menu case this whole feature exists to avoid making
 *    worse. It does nothing on commit unless the operator explicitly hits
 *    "add anyway" on THAT row; there is no bulk choice for it.
 */
export default function MenuDraftReviewGrid({
  controls,
  onCommit,
  onCancel,
  isCommitting,
}: {
  controls: MenuDraftControls;
  onCommit: () => void;
  onCancel: () => void;
  isCommitting: boolean;
}) {
  const { t } = useTranslation(["menu", "common"]);
  const {
    draft,
    totalItems,
    conflictCount,
    ambiguousCount,
    updateProduct,
    updateCategoryName,
    removeProduct,
    removeCategory,
    addProduct,
    setAllConflictPolicy,
  } = controls;

  if (!draft) return null;

  const POLICIES: { value: ConflictPolicy; label: string }[] = [
    { value: "SKIP", label: t("menu:import.conflict.skip", "Atla") as string },
    { value: "UPDATE_PRICE", label: t("menu:import.conflict.updatePrice", "Fiyatı güncelle") as string },
    { value: "CREATE", label: t("menu:import.conflict.create", "Yine de ekle") as string },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          {t("menu:import.reviewHint", "{{cats}} kategori · {{items}} ürün — düzenleyip onaylayın", {
            cats: draft.categories.length,
            items: totalItems,
          })}
        </div>
        <button type="button" onClick={onCancel} className="text-sm text-gray-500 underline hover:text-gray-700">
          {t("common:cancel", "İptal")}
        </button>
      </div>

      {conflictCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span>
            {t("menu:import.conflict.count", "{{n}} ürün menünüzde zaten var", { n: conflictCount })}
          </span>
          <select
            data-testid="conflict-bulk"
            className={`${cellCls} max-w-[14rem]`}
            defaultValue="SKIP"
            onChange={(e) => setAllConflictPolicy(e.target.value as ConflictPolicy)}
          >
            {POLICIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {ambiguousCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <AlertOctagon className="h-4 w-4 shrink-0" />
          <span>
            {t(
              "menu:import.conflict.ambiguousCount",
              "{{n}} ürün menünüzde birden fazla ürünle eşleşiyor — hiçbiri değiştirilmeyecek. " +
                "Yine de eklemek isterseniz o satırda \"Yine de ekle\"yi seçin.",
              { n: ambiguousCount },
            )}
          </span>
        </div>
      )}

      {draft.categories.map((cat, ci) => (
        <div key={ci} className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2">
            <input
              value={cat.name}
              onChange={(e) => updateCategoryName(ci, e.target.value)}
              placeholder={t("menu:import.categoryName", "Kategori adı") as string}
              className={`${cellCls} max-w-xs font-semibold ${
                !cat.name.trim() && cat.products.length > 0 ? "!border-red-500" : ""
              }`}
            />
            <button type="button" onClick={() => removeCategory(ci)} className="text-gray-400 hover:text-red-600">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-2">
            {cat.products.map((p, pi) => (
              <div
                key={pi}
                data-testid={p.ambiguous ? `ambiguous-row-${ci}-${pi}` : undefined}
                className={`grid grid-cols-12 items-center gap-2 rounded-md ${
                  p.ambiguous
                    ? "bg-red-50/60 ring-1 ring-red-300"
                    : p.existingProductId
                      ? "bg-amber-50/60 ring-1 ring-amber-200"
                      : ""
                }`}
              >
                <input
                  value={p.name}
                  onChange={(e) => updateProduct(ci, pi, { name: e.target.value })}
                  placeholder={t("menu:import.itemName", "Ürün adı") as string}
                  className={`${cellCls} col-span-3 ${!p.name.trim() ? "!border-red-500" : ""}`}
                />
                <input
                  value={p.description ?? ""}
                  onChange={(e) => updateProduct(ci, pi, { description: e.target.value })}
                  placeholder={t("menu:import.itemDesc", "Açıklama") as string}
                  className={`${cellCls} col-span-3`}
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={p.price}
                  onChange={(e) => updateProduct(ci, pi, { price: Number(e.target.value) || 0 })}
                  className={`${cellCls} col-span-2 text-right ${p.price < 0 ? "!border-red-500" : ""}`}
                />
                <select
                  value={p.taxRate ?? 10}
                  onChange={(e) => updateProduct(ci, pi, { taxRate: Number(e.target.value) })}
                  className={`${cellCls} col-span-1`}
                >
                  {TAX_RATES.map((r) => (
                    <option key={r} value={r}>%{r}</option>
                  ))}
                </select>

                {p.ambiguous ? (
                  <div className="col-span-2 flex items-center gap-1">
                    <span className="whitespace-nowrap text-xs text-red-700">
                      {t("menu:import.conflict.ambiguous", "birden çok eşleşme")}
                    </span>
                    <button
                      type="button"
                      data-testid={`ambiguous-toggle-${ci}-${pi}`}
                      onClick={() =>
                        updateProduct(ci, pi, {
                          onConflict: p.onConflict === "CREATE" ? undefined : "CREATE",
                        })
                      }
                      className={`whitespace-nowrap rounded-md border px-2 py-1 text-xs ${
                        p.onConflict === "CREATE"
                          ? "border-primary-500 bg-primary-50 text-primary-700"
                          : "border-gray-300 text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {p.onConflict === "CREATE"
                        ? t("menu:import.conflict.willCreate", "Yine de eklenecek ✓")
                        : t("menu:import.conflict.create", "Yine de ekle")}
                    </button>
                  </div>
                ) : p.existingProductId ? (
                  <div className="col-span-2 flex items-center gap-1">
                    <span className="whitespace-nowrap text-xs text-amber-700">
                      {t("menu:import.conflict.was", "şu an {{p}}", { p: p.existingPrice })}
                    </span>
                    <select
                      value={p.onConflict ?? "SKIP"}
                      onChange={(e) => updateProduct(ci, pi, { onConflict: e.target.value })}
                      className={`${cellCls} text-xs`}
                    >
                      {POLICIES.map((op) => (
                        <option key={op.value} value={op.value}>{op.label}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="col-span-2" />
                )}

                <button
                  type="button"
                  onClick={() => removeProduct(ci, pi)}
                  className="col-span-1 justify-self-center text-gray-400 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => addProduct(ci)}
            className="mt-3 inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700"
          >
            <Plus className="h-4 w-4" />
            {t("menu:import.addItem", "Ürün ekle")}
          </button>
        </div>
      ))}

      <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-gray-200 bg-white/90 py-3 backdrop-blur">
        <Button variant="outline" onClick={onCancel}>
          {t("common:cancel", "İptal")}
        </Button>
        <Button onClick={onCommit} disabled={isCommitting || totalItems === 0}>
          {isCommitting ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("menu:import.creating", "Oluşturuluyor…")}</>
          ) : (
            <><CheckCircle2 className="mr-2 h-4 w-4" />{t("menu:import.commit", "{{n}} ürünü oluştur", { n: totalItems })}</>
          )}
        </Button>
      </div>
    </div>
  );
}
