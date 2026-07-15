import { useTranslation } from "react-i18next";
import {
  Box,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { Button } from "../ui/Button";
import {
  useProduct3dConfig,
  useProduct3dStatus,
  useGenerate3d,
  has3dQuotaLeft,
} from "../../features/menu/product3dApi";
import { cn } from "../../lib/utils";
import AiLockedTeaser from "./AiLockedTeaser";
import FeatureGate from "../subscriptions/FeatureGate";

interface Props {
  productId?: string;
  /** Whether the product currently has a dish photo (Meshy needs one). */
  hasImage: boolean;
  /** Resolve/create a productId on demand so 3D can run without an explicit
      save (returns null if the draft couldn't be created). */
  ensureProductId?: () => Promise<string | null>;
}

/**
 * Phase 2 UI: turn a dish photo into a 3D model (Meshy) so the QR menu can offer
 * "view in AR on your table". Renders nothing unless the backend is configured
 * (MESHY_API_KEY / simulator) and we're editing a saved product.
 *
 * PRO+ only (feature.aiContentGeneration) — backend 403s /generate for lower
 * plans, so the gate here keeps the UI honest instead of failing on click.
 * Each real Meshy submit consumes one PHOTO quota unit server-side.
 * showUpgradePrompt is OFF: ProductMediaPanel (same editor section, same
 * feature) already renders the single upsell card — two identical prompts
 * side by side would be noise.
 */
export default function Product3dPanel(props: Props) {
  return (
    <FeatureGate feature="aiContentGeneration" showUpgradePrompt={false}>
      <Product3dPanelInner {...props} />
    </FeatureGate>
  );
}

function Product3dPanelInner({ productId, hasImage, ensureProductId }: Props) {
  const { t } = useTranslation(["menu", "common"]);
  const { data: config } = useProduct3dConfig();
  const { data: state } = useProduct3dStatus(productId, !!productId);
  const generate = useGenerate3d();

  // Only truly hide when the feature isn't wired. When configured but there's
  // no productId AND no way to create one, show a locked teaser.
  if (!config?.configured) return null;
  if (!productId && !ensureProductId)
    return <AiLockedTeaser tools={[t("menu:threeD.chip", "3D / AR")]} />;

  const status = state?.status ?? null;
  const busy = status === "PENDING" || generate.isPending;
  const quotaLeft = has3dQuotaLeft(config);
  const q = config?.models3d;

  // Flush the current form (create/update) before generating so the backend
  // reads a fresh row (image, etc.), not stale DB state.
  const handleGenerate = async () => {
    const id = ensureProductId ? await ensureProductId() : productId;
    if (id) generate.mutate(id);
  };

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900">
        <Box className="h-4 w-4 text-primary-600" />
        {t("menu:threeD.title", "3D / AR modeli")}
        {q && (
          <span
            className={cn(
              "ml-auto rounded-full px-2 py-0.5 text-xs font-medium ring-1",
              !quotaLeft
                ? "bg-amber-50 text-amber-700 ring-amber-200"
                : "bg-white text-gray-500 ring-gray-200",
            )}
          >
            {t("menu:threeD.quotaLabel", "3D")} {q.used}/
            {q.limit === -1 ? "∞" : q.limit}
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-gray-500">
        {t(
          "menu:threeD.subtitle",
          "Tabak fotoğrafından 3D model oluştur — müşteriler QR menüde masalarında AR ile görebilir.",
        )}
      </p>

      {status === "READY" ? (
        <div className="flex items-center gap-2 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4" />
          {t("menu:threeD.ready", "3D model hazır — QR menüde AR aktif")}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={handleGenerate}
            disabled={busy || !quotaLeft}
          >
            {t("menu:threeD.regenerate", "Yeniden oluştur")}
          </Button>
        </div>
      ) : status === "PENDING" ? (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t(
            "menu:threeD.pending",
            "3D model oluşturuluyor… (birkaç dakika sürebilir)",
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {status === "FAILED" && (
            <div className="flex items-center gap-1 text-xs text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" />
              {state?.error ||
                t("menu:threeD.failed", "Son deneme başarısız oldu")}
            </div>
          )}
          {!quotaLeft && (
            <div className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t(
                "menu:threeD.quotaExhausted",
                "Aylık 3D model hakkınız doldu — gelecek ay başında yenilenir. Daha yüksek limit için paketinizi yükseltin.",
              )}
            </div>
          )}
          <Button
            type="button"
            size="sm"
            onClick={handleGenerate}
            disabled={!hasImage || busy || !quotaLeft}
          >
            {generate.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("common:loading", "Yükleniyor…")}
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                {t("menu:threeD.generate", "3D model oluştur")}
              </>
            )}
          </Button>
          {!hasImage && (
            <p className="text-xs text-gray-400">
              {t("menu:threeD.needsImage", "Önce bir tabak fotoğrafı ekleyin.")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
