import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { Plus, Edit, Trash2, Image as ImageIcon } from 'lucide-react';
import {
  useCategories,
  useProducts,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
} from '../../features/menu/menuApi';
import {
  useProductImages,
  useDeleteProductImage,
  useUploadProductImages,
} from '../../features/upload/uploadApi';
import { Category, Product, ProductImage } from '../../types';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import Badge from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import ImageLibraryModal from '../../components/product/ImageLibraryModal';
import ImageUploadZone from '../../components/ui/ImageUploadZone';
import { formatCurrency } from '../../lib/utils';

const categorySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  displayOrder: z.number().optional(),
});

const productSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  price: z.number().min(0, 'Price must be positive'),
  categoryId: z.string().min(1, 'Category is required'),
  currentStock: z.number().min(0, 'Stock must be positive').optional(),
  image: z.string().url('Invalid URL').optional().or(z.literal('')), // Legacy field
  imageIds: z.array(z.string()).optional(), // New multi-image support
  isAvailable: z.boolean().optional(),
});

type CategoryFormData = z.infer<typeof categorySchema>;
type ProductFormData = z.infer<typeof productSchema>;

const MenuManagementPage = () => {
  const { t } = useTranslation(['menu', 'common']);
  const [activeTab, setActiveTab] = useState<'categories' | 'products' | 'images'>('categories');
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [imageLibraryModalOpen, setImageLibraryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productImages, setProductImages] = useState<ProductImage[]>([]);

  const { data: categories, isLoading: categoriesLoading } = useCategories();
  const { data: products, isLoading: productsLoading } = useProducts();
  const { data: allImages, isLoading: imagesLoading } = useProductImages();
  const { mutate: createCategory } = useCreateCategory();
  const { mutate: updateCategory } = useUpdateCategory();
  const { mutate: deleteCategory } = useDeleteCategory();
  const { mutate: createProduct, isPending: isCreatingProduct } = useCreateProduct();
  const { mutate: updateProduct, isPending: isUpdatingProduct } = useUpdateProduct();
  const { mutate: deleteProduct } = useDeleteProduct();
  const { mutate: deleteImage } = useDeleteProductImage();
  const uploadImagesMutation = useUploadProductImages();

  const categoryForm = useForm<CategoryFormData>({
    resolver: zodResolver(categorySchema),
  });

  const productForm = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
  });

  const handleOpenCategoryModal = (category?: Category) => {
    if (category) {
      setEditingCategory(category);
      categoryForm.reset({
        name: category.name,
        description: category.description || '',
        displayOrder: category.displayOrder,
      });
    } else {
      setEditingCategory(null);
      categoryForm.reset({});
    }
    setCategoryModalOpen(true);
  };

  const handleOpenProductModal = (product?: Product) => {
    if (product) {
      setEditingProduct(product);
      // Safely handle images array
      const productImagesList = Array.isArray(product.images) ? product.images : [];
      setProductImages(productImagesList);
      productForm.reset({
        name: product.name,
        description: product.description || '',
        price: product.price,
        categoryId: product.categoryId,
        currentStock: product.currentStock,
        image: product.image || '',
        imageIds: productImagesList.map((img) => img.id),
        isAvailable: product.isAvailable ?? true,
      });
    } else {
      setEditingProduct(null);
      setProductImages([]);
      productForm.reset({
        isAvailable: true,
      });
    }
    setProductModalOpen(true);
  };

  const handleCategorySubmit = (data: CategoryFormData) => {
    if (editingCategory) {
      updateCategory(
        { id: editingCategory.id, data },
        {
          onSuccess: () => {
            setCategoryModalOpen(false);
            categoryForm.reset();
          },
        }
      );
    } else {
      createCategory(data, {
        onSuccess: () => {
          setCategoryModalOpen(false);
          categoryForm.reset();
        },
      });
    }
  };

  const handleProductSubmit = (data: ProductFormData) => {
    console.log('Form submitted with data:', data);
    console.log('Form validation errors:', productForm.formState.errors);

    const submitData = {
      ...data,
      price: Number(data.price),
      currentStock: data.currentStock ? Number(data.currentStock) : 0,
      imageIds: productImages.map((img) => img.id),
    };

    console.log('Submitting product data:', submitData);

    if (editingProduct) {
      updateProduct(
        { id: editingProduct.id, data: submitData },
        {
          onSuccess: () => {
            console.log('Product updated successfully');
            setProductModalOpen(false);
            setProductImages([]);
            productForm.reset();
          },
          onError: (error: any) => {
            console.error('Error updating product:', error);
          },
        }
      );
    } else {
      createProduct(submitData, {
        onSuccess: () => {
          console.log('Product created successfully');
          setProductModalOpen(false);
          setProductImages([]);
          productForm.reset();
        },
        onError: (error: any) => {
          console.error('Error creating product:', error);
        },
      });
    }
  };

  const handleSelectImagesFromLibrary = (images: ProductImage[]) => {
    // Replace with selected images from library (not append, to avoid duplicates)
    setProductImages(images);
  };

  const handleConfirmUploadToLibrary = async (files: File[]) => {
    if (files.length === 0) return;
    try {
      await uploadImagesMutation.mutateAsync(files);
    } catch (error) {
      console.error('Failed to upload images:', error);
    }
  };

  const handleDeleteImage = (imageId: string) => {
    if (confirm('Are you sure you want to delete this image? This will remove it from all products.')) {
      deleteImage(imageId);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t('menu.title')}</h1>
          <p className="text-gray-600">{t('menu.manageCategoriesAndProducts')}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-4">
        <Button
          variant={activeTab === 'categories' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('categories')}
        >
          {t('menu.categories')}
        </Button>
        <Button
          variant={activeTab === 'products' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('products')}
        >
          {t('menu.items')}
        </Button>
        <Button
          variant={activeTab === 'images' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('images')}
        >
          {t('menu.imageLibrary')}
        </Button>
      </div>

      {/* Categories Tab */}
      {activeTab === 'categories' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('menu.categories')}</CardTitle>
            <Button onClick={() => handleOpenCategoryModal()}>
              <Plus className="h-4 w-4 mr-2" />
              {t('menu.addCategory')}
            </Button>
          </CardHeader>
          <CardContent>
            {categoriesLoading ? (
              <Spinner />
            ) : (
              <div className="space-y-2">
                {categories?.map((category) => (
                  <div
                    key={category.id}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                  >
                    <div>
                      <h3 className="font-semibold">{category.name}</h3>
                      {category.description && (
                        <p className="text-sm text-gray-600">
                          {category.description}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenCategoryModal(category)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          if (confirm(t('menu.confirmDeleteCategory'))) {
                            deleteCategory(category.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Products Tab */}
      {activeTab === 'products' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('menu.items')}</CardTitle>
            <Button onClick={() => handleOpenProductModal()}>
              <Plus className="h-4 w-4 mr-2" />
              {t('menu.addItem')}
            </Button>
          </CardHeader>
          <CardContent>
            {productsLoading ? (
              <Spinner />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {products?.map((product) => {
                  const primaryImage = product.images?.[0] || null;
                  const imageUrl = primaryImage
                    ? (primaryImage.url.startsWith('http://') || primaryImage.url.startsWith('https://')
                        ? primaryImage.url
                        : `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}${primaryImage.url}`)
                    : product.image || null;

                  return (
                  <div key={product.id} className="border rounded-lg p-4">
                    {imageUrl && (
                      <img
                        src={imageUrl}
                        alt={product.name}
                        className="w-full h-32 object-cover rounded-md mb-3"
                      />
                    )}
                    <div className="mb-3">
                      <div className="flex items-start justify-between mb-2">
                        <h3 className="font-semibold">{product.name}</h3>
                        <Badge variant={product.isAvailable ? 'success' : 'danger'}>
                          {product.isAvailable ? 'Available' : 'Unavailable'}
                        </Badge>
                      </div>
                      {product.description && (
                        <p className="text-sm text-gray-600 mb-2">
                          {product.description}
                        </p>
                      )}
                      <p className="text-lg font-bold text-blue-600">
                        {formatCurrency(product.price)}
                      </p>
                      <p className="text-sm text-gray-600">
                        Stock: {product.currentStock}
                      </p>
                      <p className="text-sm text-gray-600">
                        Category: {product.category?.name}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => handleOpenProductModal(product)}
                      >
                        <Edit className="h-4 w-4 mr-1" />
                        {t('app.edit')}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          if (confirm(t('menu.confirmDeleteItem'))) {
                            deleteProduct(product.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Image Library Tab */}
      {activeTab === 'images' && (
        <Card>
          <CardHeader>
            <CardTitle>Image Library</CardTitle>
            <p className="text-sm text-gray-600 mt-1">
              Manage all product images in one place. Upload new images or delete unused ones.
            </p>
          </CardHeader>
          <CardContent>
            {/* Upload Zone */}
            <div className="mb-6">
              <ImageUploadZone
                onFilesSelected={() => {}}
                onUploadConfirm={handleConfirmUploadToLibrary}
                requireConfirmation={true}
                disabled={uploadImagesMutation.isPending}
                maxFiles={20}
              />
            </div>

            {/* Images Grid */}
            {imagesLoading ? (
              <Spinner />
            ) : allImages && allImages.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {allImages.map((image) => (
                  <div
                    key={image.id}
                    className="relative group rounded-lg border overflow-hidden bg-white shadow-sm hover:shadow-md transition-all"
                  >
                    {/* Image */}
                    <div className="aspect-square flex items-center justify-center bg-gray-100">
                      <img
                        src={image.url.startsWith('http://') || image.url.startsWith('https://')
                          ? image.url
                          : `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}${image.url}`}
                        alt={image.filename}
                        className="w-full h-full object-cover"
                      />
                    </div>

                    {/* Delete Button */}
                    <button
                      onClick={() => handleDeleteImage(image.id)}
                      className="absolute top-2 right-2 z-10 bg-red-600 text-white p-1.5 rounded-full hover:bg-red-700 transition-all opacity-0 group-hover:opacity-100"
                      title="Delete image"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>

                    {/* Info */}
                    <div className="p-2 bg-gray-50">
                      <p className="text-xs truncate font-medium text-gray-900">
                        {image.filename}
                      </p>
                      <p className="text-xs text-gray-500">
                        {(image.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 px-4 border-2 border-dashed border-gray-300 rounded-lg">
                <ImageIcon className="mx-auto h-12 w-12 text-gray-400" />
                <p className="mt-2 text-sm font-medium text-gray-900">No images in library</p>
                <p className="mt-1 text-xs text-gray-500">
                  Upload images above to get started
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Category Modal */}
      <Modal
        isOpen={categoryModalOpen}
        onClose={() => setCategoryModalOpen(false)}
        title={editingCategory ? t('menu.editCategory') : t('menu.addCategory')}
      >
        <form
          onSubmit={categoryForm.handleSubmit(handleCategorySubmit)}
          className="space-y-4"
        >
          <Input
            label={t('menu.categoryName')}
            error={categoryForm.formState.errors.name?.message}
            {...categoryForm.register('name')}
          />
          <Input
            label={t('menu.description')}
            error={categoryForm.formState.errors.description?.message}
            {...categoryForm.register('description')}
          />
          <Input
            label={t('menu.displayOrder')}
            type="number"
            error={categoryForm.formState.errors.displayOrder?.message}
            {...categoryForm.register('displayOrder', { valueAsNumber: true })}
          />
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setCategoryModalOpen(false)}
            >
              {t('common:app.cancel')}
            </Button>
            <Button type="submit" className="flex-1">
              {editingCategory ? t('common:app.update') : t('common:app.create')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Product Modal */}
      <Modal
        isOpen={productModalOpen}
        onClose={() => setProductModalOpen(false)}
        title={editingProduct ? t('menu.editItem') : t('menu.addItem')}
        size="lg"
      >
        <form
          onSubmit={productForm.handleSubmit(handleProductSubmit)}
          className="space-y-4"
        >
          <Input
            label={t('menu.itemName')}
            error={productForm.formState.errors.name?.message}
            {...productForm.register('name')}
          />
          <Input
            label={t('menu.description')}
            error={productForm.formState.errors.description?.message}
            {...productForm.register('description')}
          />
          <Input
            label={t('menu.price')}
            type="number"
            step="0.01"
            error={productForm.formState.errors.price?.message}
            {...productForm.register('price', { valueAsNumber: true })}
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('menu.category')}
            </label>
            <select
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              {...productForm.register('categoryId')}
            >
              <option value="">{t('menu.selectCategory')}</option>
              {categories?.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
            {productForm.formState.errors.categoryId?.message && (
              <p className="mt-1 text-sm text-red-600">
                {productForm.formState.errors.categoryId.message}
              </p>
            )}
          </div>
          <Input
            label={t('menu.currentStock')}
            type="number"
            error={productForm.formState.errors.currentStock?.message}
            {...productForm.register('currentStock', { valueAsNumber: true })}
          />

          {/* Product Images */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('menu.productImages')}
            </label>

            {/* Show selected images */}
            {productImages.length > 0 ? (
              <div className="mb-4">
                <div className="grid grid-cols-4 gap-3">
                  {productImages.map((image, index) => (
                    <div key={image.id} className="relative group">
                      <div className="aspect-square rounded-lg overflow-hidden border-2 border-gray-200">
                        <img
                          src={image.url.startsWith('http://') || image.url.startsWith('https://')
                            ? image.url
                            : `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}${image.url}`}
                          alt={image.filename}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      {index === 0 && (
                        <div className="absolute top-1 left-1 bg-yellow-500 text-white text-xs px-2 py-0.5 rounded">
                          {t('menu.primary')}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const updated = productImages.filter(img => img.id !== image.id);
                          setProductImages(updated);
                        }}
                        className="absolute top-1 right-1 bg-red-600 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mb-4 text-center py-8 border-2 border-dashed border-gray-300 rounded-lg">
                <ImageIcon className="mx-auto h-10 w-10 text-gray-400" />
                <p className="mt-2 text-sm text-gray-600">{t('menu.noImagesSelected')}</p>
              </div>
            )}

            {/* Button to open library */}
            <Button
              type="button"
              variant="outline"
              onClick={() => setImageLibraryModalOpen(true)}
              className="w-full"
            >
              <ImageIcon className="h-4 w-4 mr-2" />
              {t('menu.chooseImagesFromLibrary')}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isAvailable"
              {...productForm.register('isAvailable')}
              className="rounded"
            />
            <label htmlFor="isAvailable" className="text-sm font-medium">
              {t('menu.available')}
            </label>
          </div>
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setProductModalOpen(false)}
              disabled={isCreatingProduct || isUpdatingProduct}
            >
              {t('common:app.cancel')}
            </Button>
            <Button
              type="submit"
              className="flex-1"
              isLoading={isCreatingProduct || isUpdatingProduct}
              disabled={isCreatingProduct || isUpdatingProduct}
            >
              {editingProduct ? t('common:app.update') : t('common:app.create')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Image Library Modal */}
      <ImageLibraryModal
        isOpen={imageLibraryModalOpen}
        onClose={() => setImageLibraryModalOpen(false)}
        onSelectImages={handleSelectImagesFromLibrary}
        selectedImageIds={productImages.map((img) => img.id)}
        maxSelection={10}
      />
    </div>
  );
};

export default MenuManagementPage;
