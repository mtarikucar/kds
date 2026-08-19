import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import i18n from "../../i18n/config";
import api from "../../lib/api";
import { getApiErrorMessage } from "../../lib/api-error";
import { useBranchScopeStore } from "../../store/branchScopeStore";
import {
  Category,
  Product,
  CreateCategoryDto,
  UpdateCategoryDto,
  CreateProductDto,
  UpdateProductDto,
  ProductFilters,
  MenuCollection,
  CreateMenuCollectionDto,
  UpdateMenuCollectionDto,
} from "../../types";

// Categories
export const useCategories = () => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ["categories", branchId],
    queryFn: async (): Promise<Category[]> => {
      const response = await api.get<Category[]>("/menu/categories");
      return response.data;
    },
  });
};

export const useCategory = (id: string) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ["categories", id, branchId],
    queryFn: async (): Promise<Category> => {
      const response = await api.get(`/menu/categories/${id}`);
      return response.data;
    },
    enabled: !!id,
  });
};

export const useCreateCategory = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateCategoryDto): Promise<Category> => {
      const response = await api.post("/menu/categories", data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success(i18n.t("common:notifications.categoryCreatedSuccessfully"));
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

export const useUpdateCategory = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateCategoryDto;
    }): Promise<Category> => {
      const response = await api.patch(`/menu/categories/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success(i18n.t("common:notifications.categoryUpdatedSuccessfully"));
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

export const useDeleteCategory = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/menu/categories/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success(i18n.t("common:notifications.categoryDeletedSuccessfully"));
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

// Collections (menu classification — kategoriden bağımsız)
export const useCollections = () => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ["collections", branchId],
    queryFn: async (): Promise<MenuCollection[]> => {
      const response = await api.get<MenuCollection[]>("/menu/collections");
      return response.data;
    },
  });
};

export const useCreateCollection = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      data: CreateMenuCollectionDto,
    ): Promise<MenuCollection> => {
      const response = await api.post("/menu/collections", data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      toast.success(i18n.t("common:notifications.operationSuccessful"));
    },
    onError: (error: any) => {
      toast.error(
        getApiErrorMessage(error, i18n.t("common:notifications.operationFailed")),
      );
    },
  });
};

export const useUpdateCollection = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateMenuCollectionDto;
    }): Promise<MenuCollection> => {
      const response = await api.patch(`/menu/collections/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      toast.success(i18n.t("common:notifications.operationSuccessful"));
    },
    onError: (error: any) => {
      toast.error(
        getApiErrorMessage(error, i18n.t("common:notifications.operationFailed")),
      );
    },
  });
};

export const useDeleteCollection = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/menu/collections/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      toast.success(i18n.t("common:notifications.operationSuccessful"));
    },
    onError: (error: any) => {
      toast.error(
        getApiErrorMessage(error, i18n.t("common:notifications.operationFailed")),
      );
    },
  });
};

// Products
export const useProducts = (filters?: ProductFilters) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ["products", filters, branchId],
    queryFn: async (): Promise<Product[]> => {
      const response = await api.get<Product[]>("/menu/products", {
        params: filters,
      });
      return response.data;
    },
  });
};

export const useProduct = (id: string) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ["products", id, branchId],
    queryFn: async (): Promise<Product> => {
      const response = await api.get(`/menu/products/${id}`);
      return response.data;
    },
    enabled: !!id,
  });
};

export const useCreateProduct = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateProductDto): Promise<Product> => {
      const response = await api.post("/menu/products", data);
      return response.data;
    },
    onSuccess: () => {
      // No toast here — the editor owns the "saved" toast, and ensureProductId's
      // silent draft creation must not surface an unexpected one.
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

export const useUpdateProduct = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateProductDto;
    }): Promise<Product> => {
      const response = await api.patch(`/menu/products/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success(i18n.t("common:notifications.productUpdatedSuccessfully"));
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

export const useDeleteProduct = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/menu/products/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success(i18n.t("common:notifications.productDeletedSuccessfully"));
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

// Reorder Categories (batch update display order)
export const useReorderCategories = () => {
  const queryClient = useQueryClient();
  // The optimistic cache writes below target the EXACT categories list key,
  // which now carries branchId — so they must read/write the same branch-keyed
  // entry the useCategories() read registers, or the optimistic reorder no-ops.
  const branchId = useBranchScopeStore((s) => s.branchId);
  const categoriesKey = ["categories", branchId] as const;

  return useMutation({
    mutationFn: async (orderedIds: string[]): Promise<void> => {
      // Single atomic batch — the server applies displayOrder = array index
      // inside ONE transaction, so a failure can never leave a half-applied
      // order (the old per-category PATCH fan-out could).
      await api.patch("/menu/categories/reorder", { orderedIds });
    },
    // Optimistic update - immediately update the cache
    onMutate: async (orderedIds: string[]) => {
      await queryClient.cancelQueries({ queryKey: categoriesKey });
      const previousCategories =
        queryClient.getQueryData<Category[]>(categoriesKey);

      if (previousCategories) {
        const updatedCategories = previousCategories.map((category) => {
          const newIndex = orderedIds.indexOf(category.id);
          if (newIndex !== -1) {
            return { ...category, displayOrder: newIndex };
          }
          return category;
        });
        queryClient.setQueryData(categoriesKey, updatedCategories);
      }

      return { previousCategories };
    },
    onError: (error: any, _variables, context) => {
      if (context?.previousCategories) {
        queryClient.setQueryData(categoriesKey, context.previousCategories);
      }
      toast.error(
        getApiErrorMessage(
          error,
          i18n.t("common:notifications.operationFailed"),
        ),
      );
      // The batch endpoint is atomic (nothing half-applies), but the rollback
      // above restores a pre-drag snapshot that may itself be stale (5-min
      // staleTime, no focus refetch). Refetch to converge on the server's
      // real order.
      queryClient.invalidateQueries({ queryKey: categoriesKey });
    },
    // NOTE: on success we intentionally do NOT invalidate — the optimistic
    // cache already matches what the server accepted.
  });
};

// Reorder Products (batch update display order within a category)
export const useReorderProducts = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orderedIds: string[]): Promise<void> => {
      // Single atomic batch — the server applies displayOrder = array index
      // inside ONE transaction and requires every id to sit in ONE category
      // (the drag UI only reorders within a category droppable), so a failure
      // can never leave a half-applied order (the old per-product PATCH
      // fan-out could).
      await api.patch("/menu/products/reorder", { orderedIds });
    },
    onSuccess: () => {
      // Invalidate all product queries to refetch with new order
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (error: any) => {
      toast.error(
        getApiErrorMessage(
          error,
          i18n.t("common:notifications.operationFailed"),
        ),
      );
      // The batch endpoint is atomic, but the list shown locally may be stale.
      // Refetch so the UI shows the server's real order instead of silently
      // keeping a stale local one.
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
};

// ── Menu import (AI photo/link/file → menu digitization) ───────────────────
export type ConflictPolicy = "SKIP" | "UPDATE_PRICE" | "CREATE";

export interface MenuImportProductDraft {
  name: string;
  description?: string;
  price: number;
  taxRate?: number;
  /**
   * Set by the server when this row's (category, name) matches exactly one
   * product the tenant already has. The row also arrives with
   * `onConflict: "SKIP"` — the operator must opt in to CREATE/UPDATE_PRICE.
   */
  existingProductId?: string;
  /** The matched product's current price, so the grid can show "was ₺X". */
  existingPrice?: number;
  /** What to do about a conflicting row. Absent (or missing existingProductId) means CREATE. */
  onConflict?: ConflictPolicy;
  /**
   * Set by the server when this row's (category, name) matches MORE than
   * one existing product (an already-doubled menu) — it deliberately did
   * not pick a winner, so `existingProductId` is absent. The commit
   * endpoint refuses the row unless the operator explicitly sets
   * `onConflict: "CREATE"`.
   */
  ambiguous?: boolean;
}
export interface MenuImportCategoryDraft {
  name: string;
  products: MenuImportProductDraft[];
}
export interface MenuImportDraft {
  categories: MenuImportCategoryDraft[];
}
export interface MenuImportCommitSummary {
  categoriesCreated: number;
  categoriesMatched: number;
  productsCreated: number;
  productsUpdated: number;
  productsSkipped: number;
  failures: { category: string; product: string; reason: string }[];
}

/** Whether the backend has an AI key wired — gates the Import tab visibility. */
export const useMenuImportStatus = () =>
  useQuery({
    queryKey: ["menu-import-status"],
    queryFn: async () => {
      const response = await api.get<{ configured: boolean }>(
        "/menu/import/status",
      );
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
  });

/** Send menu photo(s) → editable draft. Persists nothing. */
export const useParseMenuPhotos = () =>
  useMutation({
    mutationFn: async (files: File[]) => {
      const formData = new FormData();
      files.forEach((f) => formData.append("photos", f));
      const response = await api.post<MenuImportDraft>(
        "/menu/import/parse",
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
        },
      );
      return response.data;
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

/** Commit the reviewed draft → creates categories + products. */
export const useCommitMenuImport = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (draft: MenuImportDraft) => {
      const response = await api.post<MenuImportCommitSummary>(
        "/menu/import/commit",
        draft,
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
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
