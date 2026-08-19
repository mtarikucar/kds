import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Camera,
  Upload,
  Loader2,
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
import { useMenuDraft } from "./useMenuDraft";
import MenuDraftReviewGrid from "./MenuDraftReviewGrid";

/**
 * Phase 1 of the menu AI/AR feature: capture photos of a paper menu, have
 * Claude vision digitise them into an editable draft, review/correct it, then
 * bulk-create the categories + products.
 *
 * Only the capture+parse step is PRO+ gated (feature.aiContentGeneration) —
 * the /parse endpoint 403s on lower plans. Review and commit are NOT gated:
 * a tenant whose plan lapses mid-review must still be able to see and
 * commit a draft they already paid to parse (commit itself is gate-free on
 * the backend too).
 */
export default function MenuImportTab({
  onDirtyChange,
}: {
  /** Reports whether an unsaved draft (or a pending parse) exists, so the
      hosting modal can confirm before an Escape/backdrop close destroys a
      quota-consuming parse + manual edits. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  return <MenuImportTabInner onDirtyChange={onDirtyChange} />;
}

function MenuImportTabInner({
  onDirtyChange,
}: {
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation(["menu", "common"]);
  const parse = useParseMenuPhotos();
  const commit = useCommitMenuImport();
  const controls = useMenuDraft();
  const { draft, setDraft } = controls;

  const [photos, setPhotos] = useState<File[]>([]);
  const [summary, setSummary] = useState<MenuImportCommitSummary | null>(null);
  // Snapshotted from controls.withheldCounts at the moment of commit — the
  // server's own productsSkipped is structurally always 0 (SKIP rows never
  // leave the browser), so it can't be used to tell the operator what
  // didn't happen. This is computed client-side instead.
  const [withheld, setWithheld] = useState<{ skipped: number; ambiguous: number } | null>(null);

  // One object URL per File, revoked when the photo set changes/unmounts —
  // creating them inline in render leaked a blob URL on every render.
  const photoUrls = useMemo(
    () => photos.map((f) => URL.createObjectURL(f)),
    [photos],
  );
  useEffect(
    () => () => photoUrls.forEach((u) => URL.revokeObjectURL(u)),
    [photoUrls],
  );

  const dirty = !!draft || parse.isPending;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"));
    setPhotos((prev) => [...prev, ...imgs].slice(0, 10));
  };

  const handleParse = async () => {
    if (!photos.length) return;
    setSummary(null);
    try {
      const result: MenuImportDraft = await parse.mutateAsync(photos);
      setDraft(result);
    } catch {
      /* toast handled in the hook */
    }
  };

  const handleCommit = async () => {
    // Block instead of silently filtering: the button advertises the full
    // count, so a blank-name/negative-price row must be fixed or deleted.
    if (controls.invalidRowCount > 0) {
      toast.error(
        t(
          "menu:import.invalidRows",
          "{{n}} satır eksik veya hatalı (boş ad ya da negatif fiyat) — düzeltin veya silin",
          { n: controls.invalidRowCount },
        ),
      );
      return;
    }
    const cleaned = controls.cleanForCommit();
    if (!cleaned?.categories.length) {
      toast.error(t("menu:import.nothingToImport", "İçe aktarılacak ürün yok"));
      return;
    }
    // Snapshot BEFORE the request: what cleanForCommit is holding back right
    // now, so the summary can report it even though the server never saw
    // those rows (and its productsSkipped can't be trusted for this).
    const withheldNow = controls.withheldCounts;
    try {
      const result = await commit.mutateAsync(cleaned);
      setSummary(result);
      setWithheld(withheldNow);
      // What's left to review: server-reported failures, plus any
      // ambiguous row that was never sent because it's still unresolved.
      // Retained (not nulled) so the operator can come back to it instead
      // of it silently vanishing along with a parse they already paid
      // for. An ordinary SKIP conflict is not retained — it was a
      // deliberate, completed choice.
      const remaining = controls.draftAfterCommit(result.failures);
      setDraft(remaining);
      if (!remaining) setPhotos([]);
      if (result.failures.length === 0) {
        toast.success(
          t("menu:import.done", "{{count}} ürün oluşturuldu", {
            count: result.productsCreated,
          }),
        );
      } else {
        toast.warning(
          t("menu:import.partial", "{{ok}} ürün eklendi, {{fail}} başarısız.", {
            ok: result.productsCreated,
            fail: result.failures.length,
          }),
        );
      }
    } catch {
      /* toast handled in the hook */
    }
  };

  const reset = () => {
    setDraft(null);
    setPhotos([]);
    setSummary(null);
    setWithheld(null);
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

      {/* ── Step 1: capture (PRO+ gated — the /parse endpoint 403s below this plan) ── */}
      {!draft && !summary && (
        <FeatureGate feature="aiContentGeneration" showUpgradePrompt>
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
                  {photos.map((_f, i) => (
                    <div key={i} className="relative">
                      <img
                        src={photoUrls[i]}
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
        </FeatureGate>
      )}

      {/* ── Step 2: review grid (ungated — commit itself never checks the plan) ── */}
      {draft && (
        <MenuDraftReviewGrid
          controls={controls}
          onCommit={handleCommit}
          onCancel={reset}
          isCommitting={commit.isPending}
        />
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
              "{{p}} ürün · {{u}} güncellendi · {{cc}} yeni + {{cm}} mevcut kategori",
              {
                p: summary.productsCreated,
                u: summary.productsUpdated,
                cc: summary.categoriesCreated,
                cm: summary.categoriesMatched,
              },
            )}
          </p>
          {/* Computed client-side, not from summary.productsSkipped — SKIP
              rows and unresolved-ambiguous rows never reach the server, so
              its own count of them is structurally always 0. */}
          {withheld && (withheld.skipped > 0 || withheld.ambiguous > 0) && (
            <p className="mt-1 text-sm text-amber-700">
              {t(
                "menu:import.withheld",
                "{{s}} atlandı · {{a}} belirsiz, aktarılmadı",
                { s: withheld.skipped, a: withheld.ambiguous },
              )}
            </p>
          )}
          {summary.failures.length > 0 && (
            <div className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
              <div className="mb-1 flex items-center gap-1 font-medium">
                <AlertTriangle className="h-4 w-4" />
                {t("menu:import.someFailed", "{{n}} ürün oluşturulamadı", {
                  n: summary.failures.length,
                })}
              </div>
              <ul className="list-inside list-disc">
                {summary.failures.slice(0, 50).map((f, i) => (
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
