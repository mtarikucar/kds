import { useTranslation } from "react-i18next";
import { Check, Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";

interface Props {
  urls: string[];
  isVideo?: boolean;
  selectedUrl?: string | null;
  onSelect?: (url: string) => void;
  actionLabel?: string;
  busyUrl?: string | null;
}

/** A grid of generated candidates (photos or the ingredients still) the
    operator picks from — the selected one gets a ring + badge. */
export default function VariationGrid({
  urls,
  isVideo,
  selectedUrl,
  onSelect,
  actionLabel,
  busyUrl,
}: Props) {
  const { t } = useTranslation("menu");
  if (!urls.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {urls.map((url) => {
        const selected = selectedUrl === url;
        return (
          <div
            key={url}
            className={cn(
              "group relative overflow-hidden rounded-lg border-2 bg-black/5",
              selected ? "border-primary-500" : "border-gray-200",
            )}
          >
            {isVideo ? (
              <video
                src={url}
                muted
                playsInline
                preload="metadata"
                className="aspect-square w-full object-cover"
              />
            ) : (
              <img
                src={url}
                alt=""
                className="aspect-square w-full object-cover"
              />
            )}
            {selected && (
              <span className="absolute left-1 top-1 inline-flex items-center gap-1 rounded bg-primary-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
                <Check className="h-3 w-3" />
                {t("media.primary", "Seçili")}
              </span>
            )}
            {onSelect && !selected && (
              <button
                type="button"
                onClick={() => onSelect(url)}
                disabled={busyUrl === url}
                className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/60 py-1 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100"
              >
                {busyUrl === url && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
                {actionLabel ?? t("media.usePrimary", "Bunu kullan")}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
