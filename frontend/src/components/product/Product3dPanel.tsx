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
} from "../../features/menu/product3dApi";

interface Props {
  productId?: string;
  /** Whether the product currently has a dish photo (Meshy needs one). */
  hasImage: boolean;
}

/**
 * Phase 2 UI: turn a dish photo into a 3D model (Meshy) so the QR menu can offer
 * "view in AR on your table". Renders nothing unless the backend is configured
 * (MESHY_API_KEY / simulator) and we're editing a saved product.
 */
export default function Product3dPanel({ productId, hasImage }: Props) {
  const { t } = useTranslation(["menu", "common"]);
  const { data: config } = useProduct3dConfig();
  const { data: state } = useProduct3dStatus(productId, !!productId);
  const generate = useGenerate3d();

  if (!config?.configured || !productId) return null;

  const status = state?.status ?? null;
  const busy = status === "PENDING" || generate.isPending;

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Box className="h-4 w-4 text-primary-600" />
        {t("menu:threeD.title", "3D / AR modeli")}
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
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => generate.mutate(productId)}
            disabled={busy}
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
          <Button
            size="sm"
            onClick={() => generate.mutate(productId)}
            disabled={!hasImage || busy}
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
