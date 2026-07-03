import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import i18n from "../../i18n/config";
import api from "../../lib/api";
import { getApiErrorMessage } from "../../lib/api-error";

export interface ProductMediaState {
  productId: string;
  imageUrl: string | null;
  videoUrl: string | null;
  videoStatus: "PENDING" | "READY" | "FAILED" | null;
  videoError?: string | null;
  ingredientsImageUrl?: string | null;
}

/** Whether fal.ai media generation is wired on the backend (gates the UI). */
export const useProductMediaConfig = () =>
  useQuery({
    queryKey: ["product-media-config"],
    queryFn: async () => {
      const response = await api.get<{ configured: boolean }>(
        "/menu/product-media/status",
      );
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
  });

/** Current media state; polls every 5s while the video is PENDING. */
export const useProductMediaStatus = (productId?: string, enabled = true) =>
  useQuery({
    queryKey: ["product-media", productId],
    enabled: !!productId && enabled,
    queryFn: async () => {
      const response = await api.get<ProductMediaState>(
        `/menu/product-media/${productId}`,
      );
      return response.data;
    },
    refetchInterval: (query) =>
      (query.state.data as ProductMediaState | undefined)?.videoStatus ===
      "PENDING"
        ? 5000
        : false,
  });

/** Auto-generate a product photo (fal.ai text-to-image). */
export const useGenerateProductPhoto = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { productId: string; prompt?: string }) => {
      const response = await api.post<ProductMediaState>(
        `/menu/product-media/${vars.productId}/generate-photo`,
        { prompt: vars.prompt },
      );
      return response.data;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: ["product-media", vars.productId],
      });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (error: any) => {
      toast.error(
        getApiErrorMessage(
          error,
          i18n.t("common:notifications.operationFailed"),
        ),
      );
    },
  });
};

/** Generate the ingredients video (dish photo → ingredients-on-table transition). */
export const useGenerateIngredientsVideo = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (productId: string) => {
      const response = await api.post<ProductMediaState>(
        `/menu/product-media/${productId}/generate-video`,
      );
      return response.data;
    },
    onSuccess: (_data, productId) => {
      queryClient.invalidateQueries({ queryKey: ["product-media", productId] });
    },
    onError: (error: any) => {
      toast.error(
        getApiErrorMessage(
          error,
          i18n.t("common:notifications.operationFailed"),
        ),
      );
    },
  });
};
