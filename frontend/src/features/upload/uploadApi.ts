import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '../../i18n/config';
import api from '../../lib/api';
import {
  ProductImage,
  UploadProductImageResponse,
  UploadMultipleImagesResponse,
} from '../../types';

// Upload single product image
export const useUploadProductImage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File): Promise<UploadProductImageResponse> => {
      const formData = new FormData();
      formData.append('image', file);

      const response = await api.post('/upload/product-image', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-images'] });
      queryClient.invalidateQueries({ queryKey: ['unused-images'] });
      toast.success(i18n.t('common:notifications.imageUploadedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.imageUploadFailed'));
    },
  });
};

// Upload multiple product images
export const useUploadProductImages = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (files: File[]): Promise<UploadMultipleImagesResponse> => {
      const formData = new FormData();
      files.forEach((file) => {
        formData.append('images', file);
      });

      const response = await api.post('/upload/product-images', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['product-images'] });
      queryClient.invalidateQueries({ queryKey: ['unused-images'] });
      toast.success(i18n.t('common:notifications.imagesUploadedSuccessfully', { count: data.count }));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.imagesUploadFailed'));
    },
  });
};

// Get all product images
export const useProductImages = () => {
  return useQuery({
    queryKey: ['product-images'],
    queryFn: async (): Promise<ProductImage[]> => {
      const response = await api.get('/upload/product-images');
      return response.data;
    },
  });
};

// Get unused (unattached) product images
export const useUnusedImages = () => {
  return useQuery({
    queryKey: ['unused-images'],
    queryFn: async (): Promise<ProductImage[]> => {
      const response = await api.get('/upload/product-images/unused');
      return response.data;
    },
  });
};

// Delete product image
export const useDeleteProductImage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (imageId: string): Promise<void> => {
      await api.delete(`/upload/product-image/${imageId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-images'] });
      queryClient.invalidateQueries({ queryKey: ['unused-images'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(i18n.t('common:notifications.imageDeletedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.imageDeleteFailed'));
    },
  });
};

// Get images for a specific product
export const useProductImagesForProduct = (productId: string) => {
  return useQuery({
    queryKey: ['product-images', productId],
    queryFn: async (): Promise<ProductImage[]> => {
      const response = await api.get(`/menu/products/${productId}/images`);
      return response.data;
    },
    enabled: !!productId,
  });
};

// Reorder product images
export const useReorderProductImages = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      productId,
      imageIds,
    }: {
      productId: string;
      imageIds: string[];
    }): Promise<ProductImage[]> => {
      const response = await api.patch(`/menu/products/${productId}/images/reorder`, {
        imageIds,
      });
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['product-images', variables.productId] });
      queryClient.invalidateQueries({ queryKey: ['products', variables.productId] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(i18n.t('common:notifications.imagesReorderedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.imagesReorderFailed'));
    },
  });
};

// Remove image from product (detach, doesn't delete the file)
export const useRemoveImageFromProduct = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      productId,
      imageId,
    }: {
      productId: string;
      imageId: string;
    }): Promise<ProductImage[]> => {
      const response = await api.delete(`/menu/products/${productId}/images/${imageId}`);
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['product-images', variables.productId] });
      queryClient.invalidateQueries({ queryKey: ['products', variables.productId] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['unused-images'] });
      toast.success(i18n.t('common:notifications.imageRemovedFromProduct'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.imageRemoveFailed'));
    },
  });
};
