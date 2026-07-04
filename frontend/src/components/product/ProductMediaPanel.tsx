import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Image as ImageIcon,
  Clapperboard,
  Loader2,
  Sparkles,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { Button } from "../ui/Button";
import {
  useProductMediaConfig,
  useProductMediaStatus,
  useGenerateProductPhoto,
  useGenerateIngredientsFrame,
  useGenerateIngredientsVideo,
} from "../../features/menu/productMediaApi";
import AiLockedTeaser from "./AiLockedTeaser";
import type { ProductImage } from "../../types";

interface Props {
  productId?: string;
  hasImage: boolean;
  hasIngredients: boolean;
  /** Resolve/create a productId on demand so the AI tools run without an
      explicit save (returns null if the draft couldn't be created). */
  ensureProductId?: () => Promise<string | null>;
  /** Called with the generated photo (a library image) so the editor can add it
      to its image grid immediately. */
  onPhotoGenerated?: (image: ProductImage) => void;
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
  ensureProductId,
  onPhotoGenerated,
}: Props) {
  const { t } = useTranslation(["menu", "common"]);
  const { data: config } = useProductMediaConfig();
  const { data: state } = useProductMediaStatus(productId, !!productId);
  const genPhoto = useGenerateProductPhoto();
  const genFrame = useGenerateIngredientsFrame();
  const genVideo = useGenerateIngredientsVideo();

  if (!config?.configured) return null;
  if (!productId && !ensureProductId)
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

  // Always flush the current form (create OR update) before generating so the
  // backend AI reads fresh name/ingredients/images — not a stale DB row.
  const resolveId = async () =>
    (ensureProductId ? await ensureProductId() : productId) ?? null;

  const onPhoto = async () => {
    const id = await resolveId();
    if (!id) return;
    try {
      const res = await genPhoto.mutateAsync({ productId: id });
      if (res?.image) onPhotoGenerated?.(res.image);
      toast.success(t("menu:media.photoDone", "Fotoğraf oluşturuldu"));
    } catch {
      /* toast in hook */
    }
  };

  const onFrame = async () => {
    const id = await resolveId();
    if (id) genFrame.mutate(id);
  };

  const onVideo = async () => {
    const id = await resolveId();
    if (id) genVideo.mutate(id);
  };

  const hasFrame = !!state?.ingredientsImageUrl;

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Sparkles className="h-4 w-4 text-primary-600" />
        {t("menu:media.title", "Yapay zeka görsel/video")}
      </div>

      {/* Auto photo */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
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
      {/* Preview of the current/generated product photo so the operator sees
          the result immediately (it's saved as the product image). */}
      {state?.imageUrl && (
        <div className="flex items-center gap-2">
          <img
            src={state.imageUrl}
            alt=""
            className="h-20 w-20 rounded-lg border border-gray-200 object-cover"
          />
          <span className="text-xs text-gray-400">
            {t(
              "menu:media.photoIsProductImage",
              "Ürün fotoğrafı olarak kaydedildi",
            )}
          </span>
        </div>
      )}

      {/* Ingredients video — TWO steps: 1) generate + review the last frame,
          2) generate the video from that reviewed frame (never "blind"). */}
      <div className="space-y-2 border-t border-gray-200 pt-3">
        <div className="text-xs font-semibold text-gray-700">
          {t("menu:media.videoSection", "İçindekiler videosu")}
        </div>

        {!hasFrame ? (
          /* Step 1 — the last frame must be generated + reviewed first. */
          <div className="space-y-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onFrame}
              disabled={!hasIngredients || genFrame.isPending}
            >
              {genFrame.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ImageIcon className="mr-2 h-4 w-4" />
              )}
              {t("menu:media.genFrame", "1. Son kareyi oluştur")}
            </Button>
            <p className="text-xs text-gray-400">
              {!hasIngredients
                ? t(
                    "menu:media.needsIngredients",
                    "Önce İçindekiler alanını doldurun.",
                  )
                : t(
                    "menu:media.frameHint",
                    "Video için önce son kareyi üretip inceleyin — emin olmadan video üretilmez.",
                  )}
            </p>
          </div>
        ) : (
          /* Step 2 — review the frame, then generate the video. */
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-500">
              {t(
                "menu:media.frameLabel",
                "Videonun son karesi — inceleyip onaylayın",
              )}
            </p>
            {state?.ingredientsImageUrl && (
              <img
                src={state.ingredientsImageUrl}
                alt=""
                className="w-full max-w-sm rounded-lg border border-gray-200"
              />
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onFrame}
                disabled={genFrame.isPending || videoBusy}
              >
                {genFrame.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                {t("menu:media.regenFrame", "Kareyi yeniden oluştur")}
              </Button>
              {videoStatus !== "PENDING" && (
                <Button
                  type="button"
                  size="sm"
                  onClick={onVideo}
                  disabled={!hasImage || videoBusy}
                >
                  {genVideo.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Clapperboard className="mr-2 h-4 w-4" />
                  )}
                  {videoStatus === "READY"
                    ? t("menu:media.regenVideo", "Videoyu yeniden oluştur")
                    : t("menu:media.genVideo2", "2. Videoyu oluştur")}
                </Button>
              )}
            </div>
            {!hasImage && (
              <p className="text-xs text-gray-400">
                {t(
                  "menu:media.needsImage",
                  "Önce bir tabak fotoğrafı ekleyin.",
                )}
              </p>
            )}
            {videoStatus === "PENDING" && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t(
                  "menu:media.videoPending",
                  "İçindekiler videosu oluşturuluyor… (birkaç dakika sürebilir)",
                )}
              </div>
            )}
            {videoStatus === "FAILED" && (
              <div className="flex items-center gap-1 text-xs text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                {state?.videoError ||
                  t("menu:media.videoFailed", "Son deneme başarısız oldu")}
              </div>
            )}
            {videoStatus === "READY" && state?.videoUrl && (
              <video
                key={state.videoUrl}
                src={state.videoUrl}
                controls
                playsInline
                className="w-full max-w-sm rounded-lg bg-black"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
