import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import i18n from "../../i18n/config";
import api from "../../lib/api";
import { getApiErrorMessage } from "../../lib/api-error";
import type { ProductImage } from "../../types";

export type MediaJobKind = "PHOTO" | "FRAME" | "VIDEO";
export type MediaJobStatus =
  | "IN_QUEUE"
  | "IN_PROGRESS"
  | "FINALIZING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED";

export interface ProductMediaJob {
  id: string;
  kind: MediaJobKind;
  status: MediaJobStatus;
  percent: number | null;
  queuePosition: number | null;
  lastLog: string | null;
  error: string | null;
  resultUrls: string[];
  createdAt: string;
}

export interface ProductMediaState {
  productId: string;
  imageUrl: string | null;
  videoUrl: string | null;
  videoStatus: "PENDING" | "READY" | "FAILED" | null;
  videoError?: string | null;
  ingredientsImageUrl?: string | null;
  jobs: ProductMediaJob[];
  image?: ProductImage | null;
}

const ACTIVE: MediaJobStatus[] = ["IN_QUEUE", "IN_PROGRESS", "FINALIZING"];
export const isJobActive = (j?: ProductMediaJob | null) =>
  !!j && ACTIVE.includes(j.status);

/** Latest job of a kind (jobs come newest-first from the API). */
export const latestJob = (
  state: ProductMediaState | undefined,
  kind: MediaJobKind,
): ProductMediaJob | undefined => state?.jobs?.find((j) => j.kind === kind);

/** Monthly AI quota usage for one kind. limit/remaining -1 = unlimited. */
export interface AiQuotaUsage {
  used: number;
  limit: number;
  remaining: number;
}

export interface ProductMediaConfig {
  configured: boolean;
  photos: AiQuotaUsage;
  videos: AiQuotaUsage;
}

export const hasQuotaLeft = (q?: AiQuotaUsage | null) =>
  !!q && (q.limit === -1 || q.remaining > 0);

/** Whether the backend has an AI key wired + the tenant's monthly AI quota
    (gates the UI and feeds the X/Y counters in the studio header). */
export const useProductMediaConfig = () =>
  useQuery({
    queryKey: ["product-media-config"],
    queryFn: async () => {
      const res = await api.get<ProductMediaConfig>(
        "/menu/product-media/status",
      );
      return res.data;
    },
    staleTime: 60 * 1000,
  });

/** Media + job status; polls every 2s while ANY job is active. */
export const useProductMediaStatus = (productId?: string, enabled = true) =>
  useQuery({
    queryKey: ["product-media", productId],
    enabled: !!productId && enabled,
    queryFn: async () => {
      const res = await api.get<ProductMediaState>(
        `/menu/product-media/${productId}`,
      );
      return res.data;
    },
    refetchInterval: (query) => {
      const s = query.state.data as ProductMediaState | undefined;
      return s?.jobs?.some((j) => isJobActive(j)) ? 2000 : false;
    },
  });

const onErr = (error: any) =>
  toast.error(
    getApiErrorMessage(error, i18n.t("common:notifications.operationFailed")),
  );

const isJob = (d: unknown): d is ProductMediaJob =>
  !!d && typeof d === "object" && "kind" in d && "status" in d;

const useMediaMutation = <V extends { productId: string }>(
  fn: (v: V) => Promise<ProductMediaJob | ProductMediaState>,
  prependJob = false,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data, v) => {
      // Optimistically prepend the freshly-created job to the cache so the panel
      // sees an active job immediately — bridges the gap until the refetch lands
      // (otherwise the button briefly re-enables → flicker + double-submit).
      if (prependJob && isJob(data)) {
        qc.setQueryData(
          ["product-media", v.productId],
          (old?: ProductMediaState) =>
            old
              ? {
                  ...old,
                  jobs: [data, ...old.jobs.filter((j) => j.id !== data.id)],
                }
              : old,
        );
      }
      qc.invalidateQueries({ queryKey: ["product-media", v.productId] });
      qc.invalidateQueries({ queryKey: ["product-images"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      // A successful generate consumed quota — refresh the X/Y counters.
      qc.invalidateQueries({ queryKey: ["product-media-config"] });
    },
    onError: onErr,
  });
};

export const useGenerateProductPhoto = () =>
  useMediaMutation(
    async (v: { productId: string; prompt?: string; count?: number }) => {
      const res = await api.post<ProductMediaJob>(
        `/menu/product-media/${v.productId}/generate-photo`,
        { prompt: v.prompt, count: v.count },
      );
      return res.data;
    },
    true,
  );

export const useGenerateIngredientsFrame = () =>
  useMediaMutation(
    async (v: { productId: string; prompt?: string; count?: number }) => {
      const res = await api.post<ProductMediaJob>(
        `/menu/product-media/${v.productId}/generate-frame`,
        { prompt: v.prompt, count: v.count },
      );
      return res.data;
    },
    true,
  );

export const useGenerateIngredientsVideo = () =>
  useMediaMutation(async (v: { productId: string; prompt?: string }) => {
    const res = await api.post<ProductMediaJob>(
      `/menu/product-media/${v.productId}/generate-video`,
      { prompt: v.prompt },
    );
    return res.data;
  }, true);

export const useSetPrimaryImage = () =>
  useMediaMutation(async (v: { productId: string; imageUrl: string }) => {
    const res = await api.post<ProductMediaState>(
      `/menu/product-media/${v.productId}/set-primary-image`,
      { imageUrl: v.imageUrl },
    );
    return res.data;
  });
