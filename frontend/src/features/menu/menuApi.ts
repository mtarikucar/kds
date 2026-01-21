import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '../../i18n/config';
import api from '../../lib/api';
import {
  Category,
  Product,
  CreateCategoryDto,
  UpdateCategoryDto,
  CreateProductDto,
  UpdateProductDto,
  ProductFilters,
} from '../../types';

// Categories
export const useCategories = () => {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async (): Promise<Category[]> => {
      const response = await api.get('/menu/categories');
      return response.data;
    },
  });
};

export const useCategory = (id: string) => {
  return useQuery({
    queryKey: ['categories', id],
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
      const response = await api.post('/menu/categories', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      toast.success(i18n.t('common:notifications.categoryCreatedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
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
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      toast.success(i18n.t('common:notifications.categoryUpdatedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
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
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      toast.success(i18n.t('common:notifications.categoryDeletedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

// Products
export const useProducts = (filters?: ProductFilters) => {
  return useQuery({
    queryKey: ['products', filters],
    queryFn: async (): Promise<Product[]> => {
      const response = await api.get('/menu/products', { params: filters });
      return response.data;
    },
  });
};

export const useProduct = (id: string) => {
  return useQuery({
    queryKey: ['products', id],
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
      const response = await api.post('/menu/products', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(i18n.t('common:notifications.productCreatedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
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
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(i18n.t('common:notifications.productUpdatedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
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
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(i18n.t('common:notifications.productDeletedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

// Reorder Categories (batch update display order)
export const useReorderCategories = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orderedIds: string[]): Promise<void> => {
      const updates = orderedIds.map((id, index) => ({
        id,
        displayOrder: index,
      }));
      await Promise.all(
        updates.map(({ id, displayOrder }) =>
          api.patch(`/menu/categories/${id}`, { displayOrder })
        )
      );
    },
    // Optimistic update - immediately update the cache
    onMutate: async (orderedIds: string[]) => {
      await queryClient.cancelQueries({ queryKey: ['categories'] });
      const previousCategories = queryClient.getQueryData<Category[]>(['categories']);

      if (previousCategories) {
        const updatedCategories = previousCategories.map(category => {
          const newIndex = orderedIds.indexOf(category.id);
          if (newIndex !== -1) {
            return { ...category, displayOrder: newIndex };
          }
          return category;
        });
        queryClient.setQueryData(['categories'], updatedCategories);
      }

      return { previousCategories };
    },
    onError: (error: any, _variables, context) => {
      if (context?.previousCategories) {
        queryClient.setQueryData(['categories'], context.previousCategories);
      }
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
    // NOTE: We intentionally do NOT invalidate queries here.
  });
};

// Reorder Products (batch update display order within a category)
export const useReorderProducts = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orderedIds: string[]): Promise<void> => {
      console.log('useReorderProducts mutation called with:', orderedIds);
      const updates = orderedIds.map((id, index) => ({
        id,
        displayOrder: index,
      }));
      console.log('Sending updates:', updates);

      const results = await Promise.all(
        updates.map(({ id, displayOrder }) =>
          api.patch(`/menu/products/${id}`, { displayOrder })
            .then(res => {
              console.log(`Product ${id} updated to displayOrder ${displayOrder}:`, res.data);
              return res;
            })
            .catch(err => {
              console.error(`Failed to update product ${id}:`, err);
              throw err;
            })
        )
      );
      console.log('All updates complete:', results);
    },
    // Optimistic update - immediately update the cache
    onMutate: async (orderedIds: string[]) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['products'] });

      // Snapshot the previous value
      const previousProducts = queryClient.getQueryData<Product[]>(['products']);

      // Optimistically update the cache
      if (previousProducts) {
        const updatedProducts = previousProducts.map(product => {
          const newIndex = orderedIds.indexOf(product.id);
          if (newIndex !== -1) {
            return { ...product, displayOrder: newIndex };
          }
          return product;
        });
        queryClient.setQueryData(['products'], updatedProducts);
      }

      // Return context with the previous value
      return { previousProducts };
    },
    onError: (error: any, _variables, context) => {
      console.error('Reorder products error:', error);
      // Rollback to the previous value on error
      if (context?.previousProducts) {
        queryClient.setQueryData(['products'], context.previousProducts);
      }
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
    // NOTE: We intentionally do NOT invalidate queries here.
    // The optimistic update is sufficient, and refetching would
    // cause the UI to revert if backend doesn't return sorted data.
  });
};
