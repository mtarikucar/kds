import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Link2, Upload, Loader2, Sparkles, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import FeatureGate from "../../../components/subscriptions/FeatureGate";
import {
  useParseMenuSource,
  useCommitMenuImport,
  type MenuImportCommitSummary,
} from "../../../features/menu/menuApi";
import { useMenuDraft } from "./useMenuDraft";
import MenuDraftReviewGrid from "./MenuDraftReviewGrid";

const ACCEPT = ".pdf,.csv,.tsv,.xlsx,.xls,application/pdf,text/csv";

/**
 * "Kaynak ver": paste a link or drop a PDF/Excel/CSV file, and every
 * product behind it lands in the same review grid the photo importer uses.
 * Source-agnostic sibling of MenuImportTab — same parse → review → summary
 * → partial-failure-retry shape, different step 1.
 */
export default function MenuSourceTab({
  onDirtyChange,
}: {
  /** Reports whether an unsaved draft (or a pending parse) exists, so the
      hosting modal can confirm before an Escape/backdrop close destroys a
      quota-consuming parse + manual edits. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation(["menu", "common"]);
  const parse = useParseMenuSource();
  const commit = useCommitMenuImport();
  const controls = useMenuDraft();
  const { draft, setDraft } = controls;

  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<MenuImportCommitSummary | null>(null);
  // Snapshotted from controls.withheldCounts at the moment of commit — the
  // server's own productsSkipped is structurally always 0 on this path too
  // (SKIP rows never leave the browser), so it can't report what didn't
  // happen. Computed client-side instead, same as MenuImportTab.
  const [withheld, setWithheld] = useState<{ skipped: number; ambiguous: number } | null>(null);

  const dirty = !!draft || parse.isPending;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const handleParse = async () => {
    if (!url.trim() && !file) return;
    setSummary(null);
    try {
      const result = await parse.mutateAsync({ url: url.trim() || undefined, file: file ?? undefined });
      setDraft(result);
    } catch {
      /* toast handled in the hook */
    }
  };

  const reset = () => {
    setDraft(null);
    setUrl("");
    setFile(null);
    setSummary(null);
    setWithheld(null);
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
      const remaining = controls.draftAfterCommit(result.failures);
      setDraft(remaining);
      if (!remaining) {
        setUrl("");
        setFile(null);
      }
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

  return (
    <div className="space-y-6">
      {/* ── Step 1: give a source (PRO+ gated — the /parse-source endpoint 403s below this plan) ── */}
      {!draft && !summary && (
        <FeatureGate feature="aiContentGeneration" showUpgradePrompt>
          <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
            <p className="text-sm text-gray-600">
              {t(
                "menu:source.hint",
                "Menünüzün bulunduğu sayfanın adresini yapıştırın ya da PDF / Excel / CSV dosyanızı yükleyin. Tüm ürünler çıkarılıp önünüze gelir.",
              )}
            </p>

            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 shrink-0 text-gray-400" />
              <input
                data-testid="source-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://restoran.com/menu"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <Upload className="h-4 w-4 shrink-0 text-gray-400" />
              <input
                data-testid="source-file"
                type="file"
                accept={ACCEPT}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-sm"
              />
            </div>

            <Button
              data-testid="source-submit"
              onClick={handleParse}
              disabled={parse.isPending || (!url.trim() && !file)}
            >
              {parse.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("menu:source.reading", "Okunuyor…")}
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  {t("menu:source.parse", "Ürünleri çıkar")}
                </>
              )}
            </Button>
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
              "menu:source.summary",
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
