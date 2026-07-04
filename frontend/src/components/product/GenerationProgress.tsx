import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import type { ProductMediaJob } from "../../features/menu/productMediaApi";

/** Real fal-queue progress for an in-flight generation job: queue position →
    determinate %-bar with the live log → indeterminate shimmer fallback. */
export default function GenerationProgress({ job }: { job: ProductMediaJob }) {
  const { t } = useTranslation("menu");
  const pct = job.percent;

  if (job.status === "IN_QUEUE") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("media.inQueue", "Sıraya alındı")}
        {job.queuePosition != null && (
          <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-500">
            {job.queuePosition}. sıra
          </span>
        )}
      </div>
    );
  }

  if (job.status === "FINALIZING") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("media.finalizing", "İndiriliyor / kaydediliyor…")}
      </div>
    );
  }

  return (
    <div className="space-y-1.5 rounded-lg bg-gray-50 px-3 py-2">
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("media.generating", "Üretiliyor…")}
        {pct != null && (
          <span className="ml-auto font-medium text-primary-600">%{pct}</span>
        )}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
        {pct != null ? (
          <div
            className="h-full rounded-full bg-primary-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        ) : (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary-400" />
        )}
      </div>
      {job.lastLog && (
        <p className="truncate font-mono text-[10px] text-gray-400">
          {job.lastLog}
        </p>
      )}
    </div>
  );
}
