import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Image as ImageIcon,
  Clapperboard,
  Loader2,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { Button } from "../ui/Button";
import {
  useProductMediaConfig,
  useProductMediaStatus,
  useGenerateProductPhoto,
  useGenerateIngredientsVideo,
} from "../../features/menu/productMediaApi";
import AiLockedTeaser from "./AiLockedTeaser";

interface Props {
  productId?: string;
  hasImage: boolean;
  hasIngredients: boolean;
}

/**
 * fal.ai media generation for a product: auto-generate a dish photo, and
 * generate an "ingredients video" that transitions the dish photo into its
 * ingredients laid out on a table. Renders nothing unless the backend is
 * configured (FAL_KEY / simulator) and we're editing a saved product.
 */
export default function ProductMediaPanel({
  productId,
  hasImage,
  hasIngredients,
}: Props) {
  const { t } = useTranslation(["menu", "common"]);
  const { data: config } = useProductMediaConfig();
  const { data: state } = useProductMediaStatus(productId, !!productId);
  const genPhoto = useGenerateProductPhoto();
  const genVideo = useGenerateIngredientsVideo();

  if (!config?.configured) return null;
  if (!productId)
    return (
      <AiLockedTeaser
        tools={[
          t("menu:media.genPhoto", "Otomatik fotoğraf"),
          t("menu:media.genVideo", "İçindekiler videosu"),
        ]}
      />
    );

  const videoStatus = state?.videoStatus ?? null;
  const videoBusy = videoStatus === "PENDING" || genVideo.isPending;

  const onPhoto = async () => {
    try {
      await genPhoto.mutateAsync({ productId });
      toast.success(t("menu:media.photoDone", "Fotoğraf oluşturuldu"));
    } catch {
      /* toast in hook */
    }
  };

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Sparkles className="h-4 w-4 text-primary-600" />
        {t("menu:media.title", "Yapay zeka görsel/video")}
      </div>

      {/* Auto photo */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onPhoto}
          disabled={genPhoto.isPending}
        >
          {genPhoto.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ImageIcon className="mr-2 h-4 w-4" />
          )}
          {t("menu:media.genPhoto", "Otomatik fotoğraf oluştur")}
        </Button>
        <span className="text-xs text-gray-400">
          {t(
            "menu:media.genPhotoHint",
            "Ürün adı + açıklamasından profesyonel bir fotoğraf üretir",
          )}
        </span>
      </div>

      {/* Ingredients video */}
      <div className="space-y-2 border-t border-gray-200 pt-3">
        {videoStatus === "READY" && state?.videoUrl ? (
          <div className="space-y-2">
            <video
              src={state.videoUrl}
              controls
              playsInline
              className="w-full max-w-sm rounded-lg bg-black"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => genVideo.mutate(productId)}
              disabled={videoBusy}
            >
              <Clapperboard className="mr-2 h-4 w-4" />
              {t("menu:media.regenVideo", "Videoyu yeniden oluştur")}
            </Button>
          </div>
        ) : videoStatus === "PENDING" ? (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t(
              "menu:media.videoPending",
              "İçindekiler videosu oluşturuluyor… (birkaç dakika sürebilir)",
            )}
          </div>
        ) : (
          <>
            {videoStatus === "FAILED" && (
              <div className="flex items-center gap-1 text-xs text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                {state?.videoError ||
                  t("menu:media.videoFailed", "Son deneme başarısız oldu")}
              </div>
            )}
            <Button
              size="sm"
              onClick={() => genVideo.mutate(productId)}
              disabled={!hasImage || !hasIngredients || videoBusy}
            >
              {genVideo.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Clapperboard className="mr-2 h-4 w-4" />
              )}
              {t("menu:media.genVideo", "İçindekiler videosu oluştur")}
            </Button>
            <p className="text-xs text-gray-400">
              {!hasImage
                ? t(
                    "menu:media.needsImage",
                    "Önce bir tabak fotoğrafı ekleyin.",
                  )
                : !hasIngredients
                  ? t(
                      "menu:media.needsIngredients",
                      "Önce İçindekiler alanını doldurun.",
                    )
                  : t(
                      "menu:media.genVideoHint",
                      "Tabak fotoğrafı → içindekilerin masaya serilmiş hâli arasında geçiş videosu üretir; müşteriler QR menüde izler.",
                    )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
