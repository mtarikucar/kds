import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Camera,
  Upload,
  Loader2,
  Trash2,
  Plus,
  Sparkles,
  X,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "../../../components/ui/Button";
import FeatureGate from "../../../components/subscriptions/FeatureGate";
import {
  useParseMenuPhotos,
  useCommitMenuImport,
  type MenuImportDraft,
  type MenuImportCommitSummary,
} from "../../../features/menu/menuApi";

const TAX_RATES = [0, 1, 10, 20];
const cellCls =
  "w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500";

/**
 * Phase 1 of the menu AI/AR feature: capture photos of a paper menu, have
 * Claude vision digitise them into an editable draft, review/correct it, then
 * bulk-create the categories + products.
 *
 * PRO+ only (feature.aiContentGeneration): the /parse endpoint 403s on lower
 * plans (the non-AI bulk-add path stays open to everyone via BulkAddModal).
 */
export default function MenuImportTab() {
  return (
    <FeatureGate feature="aiContentGeneration" showUpgradePrompt>
      <MenuImportTabInner />
    </FeatureGate>
  );
}

function MenuImportTabInner() {
  const { t } = useTranslation(["menu", "common"]);
  const parse = useParseMenuPhotos();
  const commit = useCommitMenuImport();

  const [photos, setPhotos] = useState<File[]>([]);
  const [draft, setDraft] = useState<MenuImportDraft | null>(null);
  const [summary, setSummary] = useState<MenuImportCommitSummary | null>(null);

  const totalItems = useMemo(
    () => draft?.categories.reduce((n, c) => n + c.products.length, 0) ?? 0,
    [draft],
  );

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"));
    setPhotos((prev) => [...prev, ...imgs].slice(0, 10));
  };

  const handleParse = async () => {
    if (!photos.length) return;
    setSummary(null);
    try {
      const result = await parse.mutateAsync(photos);
      setDraft(result);
    } catch {
      /* toast handled in the hook */
    }
  };

  // ── draft editing ────────────────────────────────────────────────────────
  const updateProduct = (
    ci: number,
    pi: number,
    patch: Record<string, unknown>,
  ) =>
    setDraft((d) => {
      if (!d) return d;
      const categories = d.categories.map((c, i) =>
        i !== ci
          ? c
          : {
              ...c,
              products: c.products.map((p, j) =>
                j !== pi ? p : { ...p, ...patch },
              ),
            },
      );
      return { categories };
    });

  const updateCategoryName = (ci: number, name: string) =>
    setDraft((d) =>
      d
        ? {
            categories: d.categories.map((c, i) =>
              i === ci ? { ...c, name } : c,
            ),
          }
        : d,
    );

  const removeProduct = (ci: number, pi: number) =>
    setDraft((d) =>
      d
        ? {
            categories: d.categories.map((c, i) =>
              i !== ci
                ? c
                : { ...c, products: c.products.filter((_, j) => j !== pi) },
            ),
          }
        : d,
    );

  const removeCategory = (ci: number) =>
    setDraft((d) =>
      d ? { categories: d.categories.filter((_, i) => i !== ci) } : d,
    );

  const addProduct = (ci: number) =>
    setDraft((d) =>
      d
        ? {
            categories: d.categories.map((c, i) =>
              i !== ci
                ? c
                : { ...c, products: [...c.products, { name: "", price: 0 }] },
            ),
          }
        : d,
    );

  const handleCommit = async () => {
    if (!draft) return;
    // Drop empty rows/categories before sending.
    const cleaned: MenuImportDraft = {
      categories: draft.categories
        .map((c) => ({
          name: c.name.trim(),
          products: c.products.filter((p) => p.name.trim() && p.price >= 0),
        }))
        .filter((c) => c.name && c.products.length),
    };
    if (!cleaned.categories.length) {
      toast.error(t("menu:import.nothingToImport", "İçe aktarılacak ürün yok"));
      return;
    }
    try {
      const result = await commit.mutateAsync(cleaned);
      setSummary(result);
      setDraft(null);
      setPhotos([]);
      toast.success(
        t("menu:import.done", "{{count}} ürün oluşturuldu", {
          count: result.productsCreated,
        }),
      );
    } catch {
      /* toast handled in the hook */
    }
  };

  const reset = () => {
    setDraft(null);
    setPhotos([]);
    setSummary(null);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="mb-1 flex items-center gap-2 text-lg font-semibold text-gray-900">
          <Sparkles className="h-5 w-5 text-primary-600" />
          {t("menu:import.title", "Fotoğraftan menü oluştur")}
        </div>
        <p className="text-sm text-gray-500">
          {t(
            "menu:import.subtitle",
            "Menünüzün fotoğraflarını çekin — yapay zeka içeriği okuyup düzenlenebilir bir taslağa çevirir, siz onaylayınca ürünler oluşturulur.",
          )}
        </p>
      </div>

      {/* ── Step 1: capture ── */}
      {!draft && !summary && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6">
          <div className="flex flex-wrap gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-300 hover:bg-gray-50">
              <Camera className="h-4 w-4" />
              {t("menu:import.takePhoto", "Fotoğraf çek")}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => addPhotos(e.target.files)}
              />
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-300 hover:bg-gray-50">
              <Upload className="h-4 w-4" />
              {t("menu:import.chooseFiles", "Dosya seç")}
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => addPhotos(e.target.files)}
              />
            </label>
          </div>

          {photos.length > 0 && (
            <>
              <div className="mt-4 flex flex-wrap gap-3">
                {photos.map((f, i) => (
                  <div key={i} className="relative">
                    <img
                      src={URL.createObjectURL(f)}
                      alt=""
                      className="h-24 w-24 rounded-md object-cover ring-1 ring-gray-200"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setPhotos((p) => p.filter((_, j) => j !== i))
                      }
                      className="absolute -right-2 -top-2 rounded-full bg-white p-0.5 text-gray-500 shadow ring-1 ring-gray-200 hover:text-red-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <Button onClick={handleParse} disabled={parse.isPending}>
                  {parse.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t("menu:import.reading", "Menü okunuyor…")}
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      {t("menu:import.digitize", "Dijitalleştir ({{n}} foto)", {
                        n: photos.length,
                      })}
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Step 2: review grid ── */}
      {draft && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {t(
                "menu:import.reviewHint",
                "{{cats}} kategori · {{items}} ürün — düzenleyip onaylayın",
                {
                  cats: draft.categories.length,
                  items: totalItems,
                },
              )}
            </div>
            <button
              type="button"
              onClick={reset}
              className="text-sm text-gray-500 underline hover:text-gray-700"
            >
              {t("common:cancel", "İptal")}
            </button>
          </div>

          {draft.categories.map((cat, ci) => (
            <div
              key={ci}
              className="rounded-lg border border-gray-200 bg-white p-4"
            >
              <div className="mb-3 flex items-center gap-2">
                <input
                  value={cat.name}
                  onChange={(e) => updateCategoryName(ci, e.target.value)}
                  placeholder={
                    t("menu:import.categoryName", "Kategori adı") as string
                  }
                  className={`${cellCls} max-w-xs font-semibold`}
                />
                <button
                  type="button"
                  onClick={() => removeCategory(ci)}
                  className="text-gray-400 hover:text-red-600"
                  title={t("common:delete", "Sil") as string}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-2">
                {cat.products.map((p, pi) => (
                  <div
                    key={pi}
                    className="grid grid-cols-12 items-center gap-2"
                  >
                    <input
                      value={p.name}
                      onChange={(e) =>
                        updateProduct(ci, pi, { name: e.target.value })
                      }
                      placeholder={
                        t("menu:import.itemName", "Ürün adı") as string
                      }
                      className={`${cellCls} col-span-4`}
                    />
                    <input
                      value={p.description ?? ""}
                      onChange={(e) =>
                        updateProduct(ci, pi, { description: e.target.value })
                      }
                      placeholder={
                        t("menu:import.itemDesc", "Açıklama") as string
                      }
                      className={`${cellCls} col-span-4`}
                    />
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={p.price}
                      onChange={(e) =>
                        updateProduct(ci, pi, {
                          price: Number(e.target.value) || 0,
                        })
                      }
                      className={`${cellCls} col-span-2 text-right`}
                    />
                    <select
                      value={p.taxRate ?? 10}
                      onChange={(e) =>
                        updateProduct(ci, pi, {
                          taxRate: Number(e.target.value),
                        })
                      }
                      className={`${cellCls} col-span-1`}
                    >
                      {TAX_RATES.map((r) => (
                        <option key={r} value={r}>
                          %{r}
                        </option>
                      ))}
                    </select>
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
            <Button variant="outline" onClick={reset}>
              {t("common:cancel", "İptal")}
            </Button>
            <Button
              onClick={handleCommit}
              disabled={commit.isPending || totalItems === 0}
            >
              {commit.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("menu:import.creating", "Oluşturuluyor…")}
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  {t("menu:import.commit", "{{n}} ürünü oluştur", {
                    n: totalItems,
                  })}
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: summary ── */}
      {summary && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-5">
          <div className="mb-2 flex items-center gap-2 font-semibold text-green-800">
            <CheckCircle2 className="h-5 w-5" />
            {t("menu:import.summaryTitle", "İçe aktarma tamamlandı")}
          </div>
          <p className="text-sm text-green-700">
            {t(
              "menu:import.summary",
              "{{p}} ürün · {{cc}} yeni + {{cm}} mevcut kategori",
              {
                p: summary.productsCreated,
                cc: summary.categoriesCreated,
                cm: summary.categoriesMatched,
              },
            )}
          </p>
          {summary.failures.length > 0 && (
            <div className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
              <div className="mb-1 flex items-center gap-1 font-medium">
                <AlertTriangle className="h-4 w-4" />
                {t("menu:import.someFailed", "{{n}} ürün oluşturulamadı", {
                  n: summary.failures.length,
                })}
              </div>
              <ul className="list-inside list-disc">
                {summary.failures.slice(0, 8).map((f, i) => (
                  <li key={i}>
                    {f.category} › {f.product}: {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4">
            <Button variant="outline" onClick={reset}>
              {t("menu:import.importMore", "Yeni menü ekle")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
