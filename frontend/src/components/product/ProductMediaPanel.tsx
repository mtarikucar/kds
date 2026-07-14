import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Sparkles,
  ImageIcon,
  Clapperboard,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { Button } from "../ui/Button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import { cn } from "../../lib/utils";
import AiLockedTeaser from "./AiLockedTeaser";
import GenerationProgress from "./GenerationProgress";
import VariationGrid from "./VariationGrid";
import FeatureGate from "../subscriptions/FeatureGate";
import {
  useProductMediaConfig,
  useProductMediaStatus,
  useGenerateProductPhoto,
  useGenerateIngredientsFrame,
  useGenerateIngredientsVideo,
  useSetPrimaryImage,
  latestJob,
  isJobActive,
  hasQuotaLeft,
  type AiQuotaUsage,
} from "../../features/menu/productMediaApi";

interface Props {
  productId?: string;
  hasIngredients: boolean;
  ensureProductId?: () => Promise<string | null>;
  /** Called whenever the backend's primary image changes (a picked variation or
      the auto-set first photo) so the editor form/grid stays in sync. */
  onPrimaryChanged?: (url: string) => void;
}

const PHOTO_CHIPS = [
  "daha aydınlık",
  "üstten çekim",
  "koyu arka plan",
  "yakın plan",
  "ahşap masada",
];

/** The product editor's AI Studio: a two-tab console (Fotoğraf / İçindekiler
    videosu). Every generation is an async job with REAL progress; the operator
    steers with a prompt, picks among photo variations, and reviews the video's
    last frame before rendering.

    PRO+ only (feature.aiContentGeneration): lower plans see the upgrade
    prompt. Monthly photo/video quotas (PRO 50/5, Kurumsal 200/20) render as
    X/Y counters in the header; exhausted → buttons disable with a renewal
    note. The backend enforces both independently (403 flag / 402 quota).

    Order matters: the configured check runs BEFORE the FeatureGate — the AI
    backend ships INERT until FAL_KEY is set, and upselling a feature that
    isn't live would be a broken promise. */
export default function ProductMediaPanel(props: Props) {
  const { data: config } = useProductMediaConfig();
  if (!config?.configured) return null;
  return (
    <FeatureGate feature="aiContentGeneration" showUpgradePrompt>
      <ProductMediaPanelInner {...props} />
    </FeatureGate>
  );
}

function ProductMediaPanelInner({
  productId,
  hasIngredients,
  ensureProductId,
  onPrimaryChanged,
}: Props) {
  const { t } = useTranslation(["menu", "common"]);
  const { data: config } = useProductMediaConfig();
  const { data: state } = useProductMediaStatus(productId, !!productId);

  // Keep the editor's form/grid in sync with whatever the backend considers the
  // primary image (a picked variation OR the auto-set first photo) — otherwise
  // saving the form would clobber a set-primary that already persisted.
  useEffect(() => {
    if (state?.imageUrl) onPrimaryChanged?.(state.imageUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.imageUrl]);
  const genPhoto = useGenerateProductPhoto();
  const genFrame = useGenerateIngredientsFrame();
  const genVideo = useGenerateIngredientsVideo();
  const setPrimary = useSetPrimaryImage();

  const [photoPrompt, setPhotoPrompt] = useState("");
  const [photoCount, setPhotoCount] = useState(2);
  const [framePrompt, setFramePrompt] = useState("");
  const [videoPrompt, setVideoPrompt] = useState("");
  const [pickingUrl, setPickingUrl] = useState<string | null>(null);

  if (!config?.configured) return null;
  if (!productId && !ensureProductId)
    return (
      <AiLockedTeaser
        tools={[
          t("media.tab.photo", "Fotoğraf"),
          t("media.tab.video", "İçindekiler videosu"),
        ]}
      />
    );

  const resolveId = async () =>
    (ensureProductId ? await ensureProductId() : productId) ?? null;

  const photoJob = latestJob(state, "PHOTO");
  const frameJob = latestJob(state, "FRAME");
  const videoJob = latestJob(state, "VIDEO");
  const photoQuotaLeft = hasQuotaLeft(config?.photos);
  const videoQuotaLeft = hasQuotaLeft(config?.videos);
  // The claim is all-or-nothing (4 variations with 2 left → the whole request
  // 402s), so variation options beyond the remaining allowance are disabled
  // and the submitted count is clamped as a stale-state safety net.
  const photosRemaining =
    !config?.photos || config.photos.limit === -1
      ? Infinity
      : config.photos.remaining;
  const photoBusy = isJobActive(photoJob) || genPhoto.isPending;
  const frameBusy = isJobActive(frameJob) || genFrame.isPending;
  const videoBusy = isJobActive(videoJob) || genVideo.isPending;

  const hasDishPhoto = !!state?.imageUrl;

  const onPhoto = async () => {
    const id = await resolveId();
    if (id)
      genPhoto.mutate({
        productId: id,
        prompt: photoPrompt.trim() || undefined,
        count: Number.isFinite(photosRemaining)
          ? Math.min(photoCount, Math.max(1, photosRemaining))
          : photoCount,
      });
  };
  const onFrame = async () => {
    const id = await resolveId();
    if (id)
      genFrame.mutate({
        productId: id,
        prompt: framePrompt.trim() || undefined,
        count: 1,
      });
  };
  const onVideo = async () => {
    const id = await resolveId();
    if (id)
      genVideo.mutate({
        productId: id,
        prompt: videoPrompt.trim() || undefined,
      });
  };
  const onPick = async (url: string) => {
    const id = await resolveId();
    if (!id) return;
    setPickingUrl(url);
    setPrimary.mutate(
      { productId: id, imageUrl: url },
      { onSettled: () => setPickingUrl(null) },
    );
  };

  const addChip = (c: string) =>
    setPhotoPrompt((p) => (p.trim() ? `${p.trim()}, ${c}` : c));

  const textarea =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500";

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900">
        <Sparkles className="h-4 w-4 text-primary-600" />
        {t("media.title", "Yapay zeka stüdyo")}
        <span className="ml-auto flex items-center gap-1.5">
          <QuotaChip
            label={t("media.quotaPhotos", "Fotoğraf")}
            quota={config?.photos}
          />
          <QuotaChip
            label={t("media.quotaVideos", "Video")}
            quota={config?.videos}
          />
        </span>
      </div>

      <Tabs defaultValue="photo">
        <TabsList className="mb-3">
          <TabsTrigger value="photo">
            <ImageIcon className="mr-1.5 h-4 w-4" />
            {t("media.tab.photo", "Fotoğraf")}
          </TabsTrigger>
          <TabsTrigger value="video">
            <Clapperboard className="mr-1.5 h-4 w-4" />
            {t("media.tab.video", "İçindekiler videosu")}
          </TabsTrigger>
        </TabsList>

        {/* ── PHOTO ── */}
        <TabsContent value="photo" className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              {t("media.direction", "Yön verin (opsiyonel)")}
            </label>
            <textarea
              rows={2}
              value={photoPrompt}
              onChange={(e) => setPhotoPrompt(e.target.value)}
              placeholder={
                t(
                  "media.photoHint",
                  "Boş bırakırsanız ürün adı + açıklamasından üretir",
                ) as string
              }
              className={textarea}
            />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {PHOTO_CHIPS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => addChip(c)}
                  className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-500 hover:border-primary-300 hover:text-primary-600"
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              {t("media.variations", "Varyasyon")}:
              {[1, 2, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPhotoCount(n)}
                  disabled={n > photosRemaining}
                  className={cn(
                    "h-6 w-6 rounded text-xs font-medium",
                    photoCount === n
                      ? "bg-primary-500 text-white"
                      : "bg-white text-gray-600 ring-1 ring-gray-200",
                    n > photosRemaining && "cursor-not-allowed opacity-40",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              onClick={onPhoto}
              disabled={photoBusy || !photoQuotaLeft}
            >
              {photoJob?.status === "COMPLETED" ? (
                <RefreshCw className="mr-2 h-4 w-4" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              {photoJob?.status === "COMPLETED"
                ? t("media.regenPhoto", "Yeniden oluştur")
                : t("media.genPhoto", "Fotoğraf oluştur")}
            </Button>
          </div>

          {!photoQuotaLeft && (
            <QuotaExhaustedNote
              text={t(
                "media.quotaExhaustedPhotos",
                "Aylık fotoğraf üretim hakkınız doldu — gelecek ay başında yenilenir. Daha yüksek limit için paketinizi yükseltin.",
              )}
            />
          )}
          {photoBusy && photoJob && <GenerationProgress job={photoJob} />}
          {photoJob?.status === "FAILED" && (
            <FailedNote text={photoJob.error} />
          )}
          {photoJob?.status === "COMPLETED" &&
            photoJob.resultUrls.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-gray-500">
                  {t("media.pickPrimary", "Birincil fotoğrafı seçin:")}
                </p>
                <VariationGrid
                  urls={photoJob.resultUrls}
                  selectedUrl={state?.imageUrl}
                  onSelect={onPick}
                  busyUrl={pickingUrl}
                  actionLabel={t("media.setPrimary", "Birincil yap") as string}
                />
              </div>
            )}
        </TabsContent>

        {/* ── VIDEO ── */}
        <TabsContent value="video" className="space-y-4">
          {/* Stage A: start frame */}
          <Stage n={1} title={t("media.stage.start", "Başlangıç karesi")}>
            {hasDishPhoto ? (
              <img
                src={state!.imageUrl as string}
                alt=""
                className="w-32 rounded-lg border border-gray-200"
              />
            ) : (
              <p className="text-xs text-amber-700">
                {t(
                  "media.needPhotoForVideo",
                  "Önce Fotoğraf sekmesinden bir tabak fotoğrafı oluşturun.",
                )}
              </p>
            )}
          </Stage>

          {/* Stage B: last frame (steerable) */}
          <Stage n={2} title={t("media.stage.frame", "Son kare (içindekiler)")}>
            {!hasIngredients ? (
              <p className="text-xs text-amber-700">
                {t(
                  "media.needsIngredients",
                  "Önce İçindekiler alanını doldurun.",
                )}
              </p>
            ) : (
              <div className="space-y-2">
                <textarea
                  rows={2}
                  value={framePrompt}
                  onChange={(e) => setFramePrompt(e.target.value)}
                  placeholder={
                    t(
                      "media.frameHint2",
                      "Son kareyi yönlendirin (opsiyonel) — boşsa içindekilerden üretir",
                    ) as string
                  }
                  className={textarea}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onFrame}
                  disabled={frameBusy || !photoQuotaLeft}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {state?.ingredientsImageUrl
                    ? t("media.regenFrame", "Kareyi yeniden oluştur")
                    : t("media.genFrame", "Son kareyi oluştur")}
                </Button>
                {frameBusy && frameJob && <GenerationProgress job={frameJob} />}
                {frameJob?.status === "FAILED" && (
                  <FailedNote text={frameJob.error} />
                )}
                {state?.ingredientsImageUrl && (
                  <img
                    src={state.ingredientsImageUrl}
                    alt=""
                    className="w-full max-w-sm rounded-lg border border-gray-200"
                  />
                )}
              </div>
            )}
          </Stage>

          {/* Stage C: video (steerable) */}
          <Stage n={3} title={t("media.stage.video", "Video")}>
            <div className="space-y-2">
              <textarea
                rows={2}
                value={videoPrompt}
                onChange={(e) => setVideoPrompt(e.target.value)}
                placeholder={
                  t(
                    "media.videoHint2",
                    "Videoyu yönlendirin — geçişi tarif edin (opsiyonel)",
                  ) as string
                }
                className={textarea}
              />
              <Button
                type="button"
                size="sm"
                onClick={onVideo}
                disabled={
                  !hasDishPhoto ||
                  !state?.ingredientsImageUrl ||
                  videoBusy ||
                  !videoQuotaLeft
                }
              >
                <Clapperboard className="mr-2 h-4 w-4" />
                {state?.videoUrl
                  ? t("media.regenVideo", "Videoyu yeniden oluştur")
                  : t("media.genVideo", "Videoyu oluştur")}
              </Button>
              {!videoQuotaLeft && (
                <QuotaExhaustedNote
                  text={t(
                    "media.quotaExhaustedVideos",
                    "Aylık video üretim hakkınız doldu — gelecek ay başında yenilenir. Daha yüksek limit için paketinizi yükseltin.",
                  )}
                />
              )}
              {(!hasDishPhoto || !state?.ingredientsImageUrl) && (
                <p className="text-xs text-gray-400">
                  {t(
                    "media.videoNeeds",
                    "Video için başlangıç fotoğrafı ve son kare gerekli.",
                  )}
                </p>
              )}
              {videoBusy && videoJob && <GenerationProgress job={videoJob} />}
              {(videoJob?.status === "FAILED" ||
                state?.videoStatus === "FAILED") && (
                <FailedNote text={videoJob?.error || state?.videoError} />
              )}
              {state?.videoStatus === "READY" && state.videoUrl && (
                <video
                  key={state.videoUrl}
                  src={state.videoUrl}
                  controls
                  playsInline
                  className="w-full max-w-sm rounded-lg bg-black"
                />
              )}
            </div>
          </Stage>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stage({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-800">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700">
          {n}
        </span>
        {title}
      </div>
      {children}
    </div>
  );
}

function FailedNote({ text }: { text?: string | null }) {
  const { t } = useTranslation("menu");
  return (
    <div className="flex items-center gap-1 text-xs text-amber-700">
      <AlertTriangle className="h-3.5 w-3.5" />
      {text || t("media.failed", "Son deneme başarısız oldu")}
    </div>
  );
}

/** "Fotoğraf 12/50" pill; unlimited (-1) renders as ∞. Amber when exhausted. */
function QuotaChip({
  label,
  quota,
}: {
  label: string;
  quota?: AiQuotaUsage | null;
}) {
  if (!quota) return null;
  const exhausted = quota.limit !== -1 && quota.remaining <= 0;
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium ring-1",
        exhausted
          ? "bg-amber-50 text-amber-700 ring-amber-200"
          : "bg-white text-gray-500 ring-gray-200",
      )}
    >
      {label} {quota.used}/{quota.limit === -1 ? "∞" : quota.limit}
    </span>
  );
}

function QuotaExhaustedNote({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {text}
    </div>
  );
}
