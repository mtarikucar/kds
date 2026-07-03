import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import i18n from "../../i18n/config";
import api from "../../lib/api";
import { getApiErrorMessage } from "../../lib/api-error";

export interface Product3dState {
  productId: string;
  status: "PENDING" | "READY" | "FAILED" | null;
  glbUrl: string | null;
  usdzUrl: string | null;
  error?: string | null;
}

/** Whether Meshy 3D generation is wired on the backend (gates the UI). */
export const useProduct3dConfig = () =>
  useQuery({
    queryKey: ["product-3d-config"],
    queryFn: async () => {
      const response = await api.get<{ configured: boolean }>(
        "/menu/product-3d/status",
      );
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
  });

/**
 * Current 3D state for a product. Polls every 5s while PENDING so the panel
 * flips to READY on its own once the backend poller finishes the Meshy task.
 */
export const useProduct3dStatus = (productId?: string, enabled = true) =>
  useQuery({
    queryKey: ["product-3d", productId],
    enabled: !!productId && enabled,
    queryFn: async () => {
      const response = await api.get<Product3dState>(
        `/menu/product-3d/${productId}`,
      );
      return response.data;
    },
    refetchInterval: (query) =>
      (query.state.data as Product3dState | undefined)?.status === "PENDING"
        ? 5000
        : false,
  });

/** Kick off 3D generation from the product's dish photo. */
export const useGenerate3d = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (productId: string) => {
      const response = await api.post<Product3dState>(
        `/menu/product-3d/${productId}/generate`,
      );
      return response.data;
    },
    onSuccess: (_data, productId) => {
      queryClient.invalidateQueries({ queryKey: ["product-3d", productId] });
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
