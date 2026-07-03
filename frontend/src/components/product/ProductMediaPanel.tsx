import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Image as ImageIcon,
  Clapperboard,
  Loader2,
  Sparkles,
  AlertTriangle,
  ArrowDown,
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
  /** The live İçindekiler text — used to label the ingredients in the result. */
  ingredients?: string;
  /** Resolve/create a productId on demand so the AI tools run without an
      explicit save (returns null if the draft couldn't be created). */
  ensureProductId?: () => Promise<string | null>;
  /** Called with the new image URL after an auto-photo is generated, so the
      editor can reflect it in its main image area immediately. */
  onPhotoGenerated?: (imageUrl: string) => void;
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
  ingredients,
  ensureProductId,
  onPhotoGenerated,
}: Props) {
  const { t } = useTranslation(["menu", "common"]);
  const { data: config } = useProductMediaConfig();
  const { data: state } = useProductMediaStatus(productId, !!productId);
  const genPhoto = useGenerateProductPhoto();
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

  // Resolve the id (creating a draft if needed) before any generation.
  const resolveId = async () =>
    productId ?? (await ensureProductId?.()) ?? null;

  const onPhoto = async () => {
    const id = await resolveId();
    if (!id) return;
    try {
      const res = await genPhoto.mutateAsync({ productId: id });
      if (res?.imageUrl) onPhotoGenerated?.(res.imageUrl);
      toast.success(t("menu:media.photoDone", "Fotoğraf oluşturuldu"));
    } catch {
      /* toast in hook */
    }
  };

  const onVideo = async () => {
    const id = await resolveId();
    if (id) genVideo.mutate(id);
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
              onClick={onVideo}
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
              onClick={onVideo}
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

        {/* Result: the raw ingredients laid out side by side, each labelled. */}
        {state?.ingredientsImageUrl && (
          <div className="pt-2">
            <p className="mb-1 text-xs font-medium text-gray-500">
              {t("menu:media.ingredientsResult", "İçindekiler")}
            </p>
            <LabeledIngredients
              imageUrl={state.ingredientsImageUrl}
              ingredients={ingredients}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The generated "ingredients laid out on a table" still, with each ingredient
 * labelled above it in an elegant serif font with a straight downward arrow —
 * the raw ürünler yan yana, ne oldukları yazılı. Labels are evenly spaced from
 * the İçindekiler text (the same text the image was generated from).
 */
function LabeledIngredients({
  imageUrl,
  ingredients,
}: {
  imageUrl: string;
  ingredients?: string;
}) {
  const items = (ingredients || "")
    .split(/[,\n;•·]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);

  return (
    <div className="relative w-full max-w-sm overflow-hidden rounded-lg border border-gray-200 bg-black">
      <img src={imageUrl} alt="" className="w-full" />
      {items.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex">
          {items.map((it, i) => (
            <div
              key={i}
              className="flex flex-1 flex-col items-center px-0.5 pt-2"
            >
              <span className="max-w-full truncate rounded bg-white/85 px-1.5 py-0.5 font-serif text-[11px] italic leading-tight text-slate-900 shadow-sm">
                {it}
              </span>
              <span className="mt-0.5 block h-4 w-px bg-white/90" />
              <ArrowDown className="-mt-1.5 h-3 w-3 text-white/90 drop-shadow" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
