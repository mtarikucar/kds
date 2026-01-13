import { useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Edit,
  Trash2,
  Image as ImageIcon,
  Upload,
  Search,
  Sparkles,
  Loader2,
  X,
  Check,
  Grid3X3,
  LayoutList,
  Settings2,
  Lock,
  AlertTriangle,
} from 'lucide-react';
import {
  initializeModel,
  removeBackground,
  isBackgroundRemovalSupported,
} from '../../lib/backgroundRemoval';
import { cn } from '../../lib/utils';
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
import { Category, Product, ProductImage, ModifierGroup, Modifier, CreateModifierGroupDto, CreateModifierDto } from '../../types';
import {
  useModifierGroups,
  useCreateModifierGroup,
  useUpdateModifierGroup,
  useDeleteModifierGroup,
  useCreateModifier,
  useUpdateModifier,
  useDeleteModifier,
  useAssignModifiersToProduct,
  useProductModifiers,
} from '../../features/modifiers/modifiersApi';
import {
  ModifierGroupCard,
  ModifierGroupModal,
  ModifierItemModal,
  ProductModifierSelector,
} from '../../components/modifiers';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import Badge from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import ImageLibraryModal from '../../components/product/ImageLibraryModal';
import ImageUploadZone from '../../components/ui/ImageUploadZone';
import { formatCurrency } from '../../lib/utils';
import { useSubscription } from '../../contexts/SubscriptionContext';
import UpgradePrompt from '../../components/subscriptions/UpgradePrompt';

// Schema factories for i18n support
const createCategorySchema = (t: (key: string) => string) => z.object({
  name: z.string().min(1, t('menu.validation.nameRequired')),
  description: z.string().optional(),
  displayOrder: z.number().optional(),
});

const createProductSchema = (t: (key: string) => string) => z.object({
  name: z.string().min(1, t('menu.validation.nameRequired')),
  description: z.string().optional(),
  price: z.number().min(0, t('menu.validation.pricePositive')),
  categoryId: z.string().min(1, t('menu.validation.categoryRequired')),
  currentStock: z.number().min(0, t('menu.validation.stockPositive')).optional(),
  image: z.string().url(t('menu.validation.invalidUrl')).optional().or(z.literal('')), // Legacy field
  imageIds: z.array(z.string()).optional(), // New multi-image support
  isAvailable: z.boolean().optional(),
});

type CategoryFormData = z.infer<ReturnType<typeof createCategorySchema>>;
type ProductFormData = z.infer<ReturnType<typeof createProductSchema>>;

const MenuManagementPage = () => {
  const { t } = useTranslation(['menu', 'common', 'subscriptions']);
  const { checkLimit } = useSubscription();

  // Create translated schemas
  const categorySchema = createCategorySchema(t);
  const productSchema = createProductSchema(t);

  const [activeTab, setActiveTab] = useState<'categories' | 'products' | 'images' | 'modifiers'>('categories');
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [imageLibraryModalOpen, setImageLibraryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productImages, setProductImages] = useState<ProductImage[]>([]);

  // Modifier states
  const [modifierGroupModalOpen, setModifierGroupModalOpen] = useState(false);
  const [modifierItemModalOpen, setModifierItemModalOpen] = useState(false);
  const [editingModifierGroup, setEditingModifierGroup] = useState<ModifierGroup | null>(null);
  const [editingModifier, setEditingModifier] = useState<Modifier | null>(null);
  const [selectedGroupIdForModifier, setSelectedGroupIdForModifier] = useState<string>('');
  const [selectedModifierGroupIds, setSelectedModifierGroupIds] = useState<string[]>([]);

  // Image library state
  const [imageSearchTerm, setImageSearchTerm] = useState('');
  const [imageViewMode, setImageViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [bgRemovalEnabled, setBgRemovalEnabled] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingFile, setProcessingFile] = useState<string | null>(null);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const bgRemovalSupported = isBackgroundRemovalSupported();

  const { data: categories, isLoading: categoriesLoading } = useCategories();
  const { data: products, isLoading: productsLoading } = useProducts();
  const { data: allImages, isLoading: imagesLoading } = useProductImages();

  // Check limits for categories and products
  const categoryLimit = checkLimit('maxCategories', categories?.length ?? 0);
  const productLimit = checkLimit('maxProducts', products?.length ?? 0);
  const canAddCategory = categoryLimit.allowed;
  const canAddProduct = productLimit.allowed;
  const { mutate: createCategory } = useCreateCategory();
  const { mutate: updateCategory } = useUpdateCategory();
  const { mutate: deleteCategory } = useDeleteCategory();
  const { mutate: createProduct, isPending: isCreatingProduct } = useCreateProduct();
  const { mutate: updateProduct, isPending: isUpdatingProduct } = useUpdateProduct();
  const { mutate: deleteProduct } = useDeleteProduct();
  const { mutate: deleteImage } = useDeleteProductImage();
  const uploadImagesMutation = useUploadProductImages();

  // Modifier hooks
  const { data: modifierGroups, isLoading: modifierGroupsLoading } = useModifierGroups(true);
  const { mutate: createModifierGroup, isPending: isCreatingModifierGroup } = useCreateModifierGroup();
  const { mutate: updateModifierGroup, isPending: isUpdatingModifierGroup } = useUpdateModifierGroup();
  const { mutate: deleteModifierGroup } = useDeleteModifierGroup();
  const { mutate: createModifier, isPending: isCreatingModifier } = useCreateModifier();
  const { mutate: updateModifier, isPending: isUpdatingModifier } = useUpdateModifier();
  const { mutate: deleteModifier } = useDeleteModifier();
  const { mutate: assignModifiersToProduct } = useAssignModifiersToProduct();

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
      // Safely handle modifier groups array
      const productModifierGroupIds = Array.isArray(product.modifierGroups)
        ? product.modifierGroups.map((mg) => mg.id)
        : [];
      setSelectedModifierGroupIds(productModifierGroupIds);
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
      setSelectedModifierGroupIds([]);
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
            // Assign modifier groups
            if (selectedModifierGroupIds.length > 0) {
              assignModifiersToProduct({
                productId: editingProduct.id,
                data: {
                  modifierGroups: selectedModifierGroupIds.map((groupId, index) => ({
                    groupId,
                    displayOrder: index,
                  })),
                },
              });
            }
            setProductModalOpen(false);
            setProductImages([]);
            setSelectedModifierGroupIds([]);
            productForm.reset();
          },
          onError: (error: any) => {
            console.error('Error updating product:', error);
          },
        }
      );
    } else {
      createProduct(submitData, {
        onSuccess: (newProduct) => {
          console.log('Product created successfully');
          // Assign modifier groups to newly created product
          if (selectedModifierGroupIds.length > 0 && newProduct?.id) {
            assignModifiersToProduct({
              productId: newProduct.id,
              data: {
                modifierGroups: selectedModifierGroupIds.map((groupId, index) => ({
                  groupId,
                  displayOrder: index,
                })),
              },
            });
          }
          setProductModalOpen(false);
          setProductImages([]);
          setSelectedModifierGroupIds([]);
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

  // Modifier Handlers
  const handleOpenModifierGroupModal = (group?: ModifierGroup) => {
    if (group) {
      setEditingModifierGroup(group);
    } else {
      setEditingModifierGroup(null);
    }
    setModifierGroupModalOpen(true);
  };

  const handleModifierGroupSubmit = (data: CreateModifierGroupDto) => {
    if (editingModifierGroup) {
      updateModifierGroup(
        { id: editingModifierGroup.id, data },
        {
          onSuccess: () => {
            setModifierGroupModalOpen(false);
            setEditingModifierGroup(null);
          },
        }
      );
    } else {
      createModifierGroup(data, {
        onSuccess: () => {
          setModifierGroupModalOpen(false);
        },
      });
    }
  };

  const handleDeleteModifierGroup = (group: ModifierGroup) => {
    if (confirm(t('menu.confirmDeleteModifierGroup'))) {
      deleteModifierGroup(group.id);
    }
  };

  const handleOpenModifierItemModal = (groupId: string, modifier?: Modifier) => {
    setSelectedGroupIdForModifier(groupId);
    if (modifier) {
      setEditingModifier(modifier);
    } else {
      setEditingModifier(null);
    }
    setModifierItemModalOpen(true);
  };

  const handleModifierItemSubmit = (data: CreateModifierDto) => {
    if (editingModifier) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { groupId, ...updateData } = data;
      updateModifier(
        { id: editingModifier.id, data: updateData },
        {
          onSuccess: () => {
            setModifierItemModalOpen(false);
            setEditingModifier(null);
          },
        }
      );
    } else {
      createModifier(data, {
        onSuccess: () => {
          setModifierItemModalOpen(false);
        },
      });
    }
  };

  const handleDeleteModifier = (modifier: Modifier) => {
    if (confirm(t('menu.confirmDeleteModifier'))) {
      deleteModifier(modifier.id);
    }
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
    if (confirm(t('menu.confirmDeleteImage'))) {
      deleteImage(imageId);
    }
  };

  // Image library helpers
  const getImageUrl = (url: string) => {
    if (url.startsWith('http')) return url;
    return `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}${url}`;
  };

  const filteredImages = allImages?.filter((img) =>
    img.filename.toLowerCase().includes(imageSearchTerm.toLowerCase())
  ) || [];

  const toggleImageSelection = (id: string) => {
    const newSelection = new Set(selectedImages);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedImages(newSelection);
  };

  const handleDeleteSelectedImages = async () => {
    if (selectedImages.size === 0) return;
    if (!window.confirm(t('menu.imageLibraryUI.deleteConfirm', { count: selectedImages.size }))) return;
    for (const id of selectedImages) {
      await deleteImage(id);
    }
    setSelectedImages(new Set());
  };

  const processWithBgRemoval = async (files: File[]): Promise<File[]> => {
    if (!bgRemovalEnabled || !bgRemovalSupported) return files;
    setIsProcessing(true);
    const processed: File[] = [];
    try {
      setIsModelLoading(true);
      await initializeModel();
      setIsModelLoading(false);
      for (const file of files) {
        setProcessingFile(file.name);
        try {
          const result = await removeBackground(file);
          processed.push(result);
        } catch {
          processed.push(file);
        }
      }
    } catch {
      return files;
    } finally {
      setIsProcessing(false);
      setProcessingFile(null);
    }
    return processed;
  };

  const handleImageFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter(
      (f) => f.type.startsWith('image/') && f.size <= 5 * 1024 * 1024
    );
    if (fileArray.length === 0) return;
    const filesToUpload = await processWithBgRemoval(fileArray);
    uploadImagesMutation.mutate(filesToUpload);
  }, [bgRemovalEnabled, bgRemovalSupported, uploadImagesMutation]);

  const handleImageDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleImageFiles(e.dataTransfer.files);
  }, [handleImageFiles]);

  const handleImageFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleImageFiles(e.target.files);
      e.target.value = '';
    }
  };

  return (
    <div>
      <div className="mb-4 md:mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{t('menu.title')}</h1>
        <p className="text-sm md:text-base text-gray-600">{t('menu.manageCategoriesAndProducts')}</p>
      </div>

      {/* Tabs */}
      <div className="mb-4 md:mb-6 flex flex-wrap gap-2 md:gap-4">
        <Button
          variant={activeTab === 'categories' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('categories')}
          size="sm"
          className="md:text-base"
        >
          {t('menu.categories')}
        </Button>
        <Button
          variant={activeTab === 'products' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('products')}
          size="sm"
          className="md:text-base"
        >
          {t('menu.items')}
        </Button>
        <Button
          variant={activeTab === 'images' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('images')}
          size="sm"
          className="md:text-base"
        >
          {t('menu.imageLibrary')}
        </Button>
        <Button
          variant={activeTab === 'modifiers' ? 'primary' : 'outline'}
          onClick={() => setActiveTab('modifiers')}
          size="sm"
          className="md:text-base"
        >
          <Settings2 className="h-4 w-4 mr-1 md:mr-2" />
          {t('menu.modifiers')}
        </Button>
      </div>

      {/* Categories Tab */}
      {activeTab === 'categories' && (
        <>
          {/* Category Limit Info */}
          {categoryLimit.limit !== -1 && (
            <div className={`rounded-lg p-4 flex items-start gap-3 mb-4 ${
              canAddCategory
                ? 'bg-blue-50 border border-blue-200'
                : 'bg-amber-50 border border-amber-200'
            }`}>
              <AlertTriangle className={`h-5 w-5 mt-0.5 ${canAddCategory ? 'text-blue-600' : 'text-amber-600'}`} />
              <div>
                <h3 className={`font-semibold ${canAddCategory ? 'text-blue-900' : 'text-amber-900'}`}>
                  {t('menu.categories')}: {categories?.length ?? 0} / {categoryLimit.limit}
                </h3>
                <p className={`text-sm ${canAddCategory ? 'text-blue-700' : 'text-amber-700'}`}>
                  {canAddCategory
                    ? t('common:admin.subscriptionLimitInfo')
                    : t('subscriptions:subscriptions.limitReachedDescription', {
                        resource: t('menu.categories'),
                        current: categories?.length ?? 0,
                        limit: categoryLimit.limit,
                      })}
                </p>
              </div>
            </div>
          )}

          {/* Upgrade Prompt when category limit reached */}
          {!canAddCategory && (
            <div className="mb-4">
              <UpgradePrompt
                limitType="maxCategories"
                currentCount={categories?.length ?? 0}
                limit={categoryLimit.limit}
              />
            </div>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{t('menu.categories')}</CardTitle>
              <Button onClick={() => handleOpenCategoryModal()} disabled={!canAddCategory}>
                {canAddCategory ? (
                  <Plus className="h-4 w-4 mr-2" />
                ) : (
                  <Lock className="h-4 w-4 mr-2" />
                )}
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
        </>
      )}

      {/* Products Tab */}
      {activeTab === 'products' && (
        <>
          {/* Product Limit Info */}
          {productLimit.limit !== -1 && (
            <div className={`rounded-lg p-4 flex items-start gap-3 mb-4 ${
              canAddProduct
                ? 'bg-blue-50 border border-blue-200'
                : 'bg-amber-50 border border-amber-200'
            }`}>
              <AlertTriangle className={`h-5 w-5 mt-0.5 ${canAddProduct ? 'text-blue-600' : 'text-amber-600'}`} />
              <div>
                <h3 className={`font-semibold ${canAddProduct ? 'text-blue-900' : 'text-amber-900'}`}>
                  {t('menu.items')}: {products?.length ?? 0} / {productLimit.limit}
                </h3>
                <p className={`text-sm ${canAddProduct ? 'text-blue-700' : 'text-amber-700'}`}>
                  {canAddProduct
                    ? t('common:admin.subscriptionLimitInfo')
                    : t('subscriptions:subscriptions.limitReachedDescription', {
                        resource: t('subscriptions:subscriptions.planLimits.products'),
                        current: products?.length ?? 0,
                        limit: productLimit.limit,
                      })}
                </p>
              </div>
            </div>
          )}

          {/* Upgrade Prompt when product limit reached */}
          {!canAddProduct && (
            <div className="mb-4">
              <UpgradePrompt
                limitType="maxProducts"
                currentCount={products?.length ?? 0}
                limit={productLimit.limit}
              />
            </div>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{t('menu.items')}</CardTitle>
              <Button onClick={() => handleOpenProductModal()} disabled={!canAddProduct}>
                {canAddProduct ? (
                  <Plus className="h-4 w-4 mr-2" />
                ) : (
                  <Lock className="h-4 w-4 mr-2" />
                )}
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
                            {product.isAvailable ? t('menu.available') : t('menu.unavailable')}
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
                          {t('menu.stock')}: {product.currentStock}
                        </p>
                        <p className="text-sm text-gray-600">
                          {t('menu.category')}: {product.category?.name}
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
                          {t('common:app.edit')}
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
        </>
      )}

      {/* Image Library Tab - Minimal Design */}
      {activeTab === 'images' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar */}
          <div className="lg:col-span-1 space-y-4">
            {/* Upload Zone */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-medium text-gray-900 mb-3">Upload</h3>
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleImageDrop}
                className={cn(
                  'border-2 border-dashed rounded-lg p-6 text-center transition-all cursor-pointer',
                  isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400',
                  (isProcessing || uploadImagesMutation.isPending) && 'opacity-50 pointer-events-none'
                )}
              >
                <input
                  type="file"
                  id="image-upload"
                  multiple
                  accept="image/*"
                  onChange={handleImageFileInput}
                  className="hidden"
                  disabled={isProcessing || uploadImagesMutation.isPending}
                />
                <label htmlFor="image-upload" className="cursor-pointer">
                  {uploadImagesMutation.isPending ? (
                    <Loader2 className="w-8 h-8 mx-auto text-gray-400 animate-spin" />
                  ) : (
                    <Upload className="w-8 h-8 mx-auto text-gray-400" />
                  )}
                  <p className="mt-2 text-sm text-gray-600">
                    {uploadImagesMutation.isPending ? t('menu.imageLibraryUI.uploading') : t('menu.imageLibraryUI.dropOrClick')}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">{t('menu.imageLibraryUI.uploadHint')}</p>
                </label>
              </div>
            </div>

            {/* Background Removal */}
            {bgRemovalSupported && (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'w-8 h-8 rounded-lg flex items-center justify-center',
                      bgRemovalEnabled ? 'bg-violet-100' : 'bg-gray-100'
                    )}>
                      <Sparkles className={cn(
                        'w-4 h-4',
                        bgRemovalEnabled ? 'text-violet-600' : 'text-gray-400'
                      )} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{t('menu.imageLibraryUI.removeBg')}</p>
                      <p className="text-xs text-gray-500">{t('menu.imageLibraryUI.aiPowered')}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setBgRemovalEnabled(!bgRemovalEnabled)}
                    disabled={isProcessing}
                    className={cn(
                      'relative w-10 h-5 rounded-full transition-colors',
                      bgRemovalEnabled ? 'bg-violet-600' : 'bg-gray-200'
                    )}
                  >
                    <span className={cn(
                      'absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
                      bgRemovalEnabled && 'translate-x-5'
                    )} />
                  </button>
                </div>
                {(isModelLoading || isProcessing) && (
                  <div className="mt-3 p-2 bg-violet-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-3 h-3 text-violet-600 animate-spin" />
                      <span className="text-xs text-violet-700">
                        {isModelLoading ? t('menu.imageLibraryUI.loadingModel') : processingFile}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Search */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search..."
                  value={imageSearchTerm}
                  onChange={(e) => setImageSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {imageSearchTerm && (
                  <button onClick={() => setImageSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                    <X className="w-4 h-4 text-gray-400 hover:text-gray-600" />
                  </button>
                )}
              </div>
            </div>

            {/* View Toggle */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex gap-2">
                <button
                  onClick={() => setImageViewMode('grid')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm font-medium transition-colors',
                    imageViewMode === 'grid' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'
                  )}
                >
                  <Grid3X3 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setImageViewMode('list')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm font-medium transition-colors',
                    imageViewMode === 'list' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'
                  )}
                >
                  <LayoutList className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Delete Selected */}
            {selectedImages.size > 0 && (
              <button
                onClick={handleDeleteSelectedImages}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100"
              >
                <Trash2 className="w-4 h-4" />
                Delete ({selectedImages.size})
              </button>
            )}
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3">
            <div className="bg-white rounded-xl border border-gray-200 min-h-[500px]">
              {imagesLoading ? (
                <div className="flex items-center justify-center h-96">
                  <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
                </div>
              ) : filteredImages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-96 text-center px-4">
                  <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                    <ImageIcon className="w-7 h-7 text-gray-400" />
                  </div>
                  <h3 className="text-base font-medium text-gray-900">
                    {imageSearchTerm ? t('menu.imageLibraryUI.noImagesFound') : t('menu.imageLibraryUI.noImagesYet')}
                  </h3>
                  <p className="mt-1 text-sm text-gray-500">
                    {imageSearchTerm ? t('menu.imageLibraryUI.tryDifferentSearch') : t('menu.imageLibraryUI.uploadToStart')}
                  </p>
                </div>
              ) : imageViewMode === 'grid' ? (
                <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {filteredImages.map((image) => (
                    <div
                      key={image.id}
                      onClick={() => toggleImageSelection(image.id)}
                      className={cn(
                        'group relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all',
                        selectedImages.has(image.id)
                          ? 'border-blue-500 ring-2 ring-blue-500/20'
                          : 'border-transparent hover:border-gray-300'
                      )}
                    >
                      <div
                        className="absolute inset-0"
                        style={{ background: 'repeating-conic-gradient(#f3f4f6 0% 25%, #fff 0% 50%) 50% / 12px 12px' }}
                      />
                      <img src={getImageUrl(image.url)} alt={image.filename} className="relative w-full h-full object-cover" />

                      <div className={cn(
                        'absolute top-2 left-2 w-5 h-5 rounded-full flex items-center justify-center transition-all',
                        selectedImages.has(image.id)
                          ? 'bg-blue-500 text-white'
                          : 'bg-white/80 border border-gray-300 opacity-0 group-hover:opacity-100'
                      )}>
                        {selectedImages.has(image.id) && <Check className="w-3 h-3" />}
                      </div>

                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteImage(image.id); }}
                        className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded opacity-0 group-hover:opacity-100 hover:bg-red-600"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>

                      {image.filename.includes('_nobg') && (
                        <div className="absolute bottom-2 left-2 px-1.5 py-0.5 bg-violet-500 text-white text-[10px] font-medium rounded flex items-center gap-0.5">
                          <Sparkles className="w-2.5 h-2.5" /> AI
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {filteredImages.map((image) => (
                    <div
                      key={image.id}
                      onClick={() => toggleImageSelection(image.id)}
                      className={cn(
                        'flex items-center gap-4 p-3 cursor-pointer transition-colors',
                        selectedImages.has(image.id) ? 'bg-blue-50' : 'hover:bg-gray-50'
                      )}
                    >
                      <div className={cn(
                        'w-5 h-5 rounded border flex items-center justify-center flex-shrink-0',
                        selectedImages.has(image.id) ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
                      )}>
                        {selectedImages.has(image.id) && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <div
                        className="w-10 h-10 rounded overflow-hidden flex-shrink-0"
                        style={{ background: 'repeating-conic-gradient(#f3f4f6 0% 25%, #fff 0% 50%) 50% / 6px 6px' }}
                      >
                        <img src={getImageUrl(image.url)} alt={image.filename} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-900 truncate">{image.filename}</p>
                          {image.filename.includes('_nobg') && (
                            <span className="px-1.5 py-0.5 bg-violet-100 text-violet-700 text-xs font-medium rounded">AI</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">{(image.size / 1024).toFixed(1)} KB</p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteImage(image.id); }}
                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modifiers Tab */}
      {activeTab === 'modifiers' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('menu.modifierGroups')}</CardTitle>
            <Button onClick={() => handleOpenModifierGroupModal()}>
              <Plus className="h-4 w-4 mr-2" />
              {t('menu.addModifierGroup')}
            </Button>
          </CardHeader>
          <CardContent>
            {modifierGroupsLoading ? (
              <Spinner />
            ) : !modifierGroups || modifierGroups.length === 0 ? (
              <div className="text-center py-12">
                <Settings2 className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-4 text-lg font-medium text-gray-900">
                  {t('menu.noModifierGroups')}
                </h3>
                <p className="mt-2 text-sm text-gray-500">
                  {t('menu.noModifierGroupsDesc')}
                </p>
                <Button
                  className="mt-4"
                  onClick={() => handleOpenModifierGroupModal()}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t('menu.addModifierGroup')}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {modifierGroups
                  .sort((a, b) => a.displayOrder - b.displayOrder)
                  .map((group) => (
                    <ModifierGroupCard
                      key={group.id}
                      group={group}
                      onEditGroup={handleOpenModifierGroupModal}
                      onDeleteGroup={handleDeleteModifierGroup}
                      onAddModifier={(groupId) => handleOpenModifierItemModal(groupId)}
                      onEditModifier={(modifier) => handleOpenModifierItemModal(modifier.groupId, modifier)}
                      onDeleteModifier={handleDeleteModifier}
                    />
                  ))}
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

          {/* Modifier Groups */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('menu.modifierGroups')}
            </label>
            <ProductModifierSelector
              productId={editingProduct?.id}
              selectedGroupIds={selectedModifierGroupIds}
              onSelectionChange={setSelectedModifierGroupIds}
            />
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

      {/* Modifier Group Modal */}
      <ModifierGroupModal
        isOpen={modifierGroupModalOpen}
        onClose={() => {
          setModifierGroupModalOpen(false);
          setEditingModifierGroup(null);
        }}
        onSubmit={handleModifierGroupSubmit}
        editingGroup={editingModifierGroup}
        isLoading={isCreatingModifierGroup || isUpdatingModifierGroup}
      />

      {/* Modifier Item Modal */}
      <ModifierItemModal
        isOpen={modifierItemModalOpen}
        onClose={() => {
          setModifierItemModalOpen(false);
          setEditingModifier(null);
        }}
        onSubmit={handleModifierItemSubmit}
        editingModifier={editingModifier}
        groupId={selectedGroupIdForModifier}
        isLoading={isCreatingModifier || isUpdatingModifier}
      />
    </div>
  );
};

export default MenuManagementPage;
