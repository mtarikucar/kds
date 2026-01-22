import { useState, useCallback, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { DragDropContext, Droppable, DropResult } from '@hello-pangea/dnd';
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
  ChevronsUpDown,
  Package,
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
  useReorderCategories,
  useReorderProducts,
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
} from '../../features/modifiers/modifiersApi';
import {
  ModifierGroupCard,
  ModifierGroupModal,
  ModifierItemModal,
  ProductModifierSelector,
} from '../../components/modifiers';
import { DraggableCategoryCard } from '../../components/menu';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import Spinner from '../../components/ui/Spinner';
import ImageLibraryModal from '../../components/product/ImageLibraryModal';
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
  image: z.string().url(t('menu.validation.invalidUrl')).optional().or(z.literal('')),
  imageIds: z.array(z.string()).optional(),
  isAvailable: z.boolean().optional(),
});

type CategoryFormData = z.infer<ReturnType<typeof createCategorySchema>>;
type ProductFormData = z.infer<ReturnType<typeof createProductSchema>>;

// Helper function to reorder items in an array
const reorder = <T,>(list: T[], startIndex: number, endIndex: number): T[] => {
  const result = Array.from(list);
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  return result;
};

const MenuManagementPage = () => {
  const { t } = useTranslation(['menu', 'common', 'subscriptions']);
  const { checkLimit } = useSubscription();

  // Create translated schemas
  const categorySchema = createCategorySchema(t);
  const productSchema = createProductSchema(t);

  const [activeTab, setActiveTab] = useState<'menu' | 'images' | 'modifiers'>('menu');
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [imageLibraryModalOpen, setImageLibraryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productImages, setProductImages] = useState<ProductImage[]>([]);
  const [preselectedCategoryId, setPreselectedCategoryId] = useState<string | null>(null);
  const [allCategoriesExpanded, setAllCategoriesExpanded] = useState(true);

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

  // Reorder mutations
  const { mutate: reorderCategories } = useReorderCategories();
  const { mutate: reorderProducts } = useReorderProducts();

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

  // Sort categories by displayOrder
  const sortedCategories = useMemo(() => {
    if (!categories) return [];
    return [...categories].sort((a, b) => a.displayOrder - b.displayOrder);
  }, [categories]);

  // Group products by category
  const productsByCategory = useMemo(() => {
    if (!products) return {};
    return products.reduce((acc, product) => {
      const categoryId = product.categoryId;
      if (!acc[categoryId]) {
        acc[categoryId] = [];
      }
      acc[categoryId].push(product);
      return acc;
    }, {} as Record<string, Product[]>);
  }, [products]);

  // Products without category (uncategorized)
  const uncategorizedProducts = useMemo(() => {
    if (!products || !categories) return [];
    const categoryIds = new Set(categories.map(c => c.id));
    return products.filter(p => !categoryIds.has(p.categoryId));
  }, [products, categories]);

  // Drag & Drop handler
  const handleDragEnd = useCallback((result: DropResult) => {
    const { source, destination, type, draggableId } = result;

    console.log('handleDragEnd called:', { source, destination, type, draggableId });

    if (!destination) {
      console.log('No destination, returning');
      return;
    }
    if (source.index === destination.index && source.droppableId === destination.droppableId) {
      console.log('Same position, returning');
      return;
    }

    if (type === 'CATEGORY') {
      console.log('Reordering categories');
      const reordered = reorder(sortedCategories, source.index, destination.index);
      reorderCategories(reordered.map(c => c.id));
    } else if (type === 'PRODUCT') {
      // droppableId is "products-{categoryId}"
      const categoryId = source.droppableId.replace('products-', '');
      console.log('Reordering products in category:', categoryId);
      const categoryProducts = productsByCategory[categoryId] || [];
      console.log('Category products:', categoryProducts.map(p => ({ id: p.id, name: p.name, displayOrder: p.displayOrder })));

      const sortedCategoryProducts = [...categoryProducts].sort((a, b) => {
        const orderA = a.displayOrder ?? 0;
        const orderB = b.displayOrder ?? 0;
        return orderA - orderB;
      });
      console.log('Sorted products before reorder:', sortedCategoryProducts.map(p => p.name));

      const reordered = reorder(sortedCategoryProducts, source.index, destination.index);
      console.log('Reordered products:', reordered.map(p => p.name));
      console.log('Sending IDs to API:', reordered.map(p => p.id));

      reorderProducts(reordered.map(p => p.id));
    }
  }, [sortedCategories, productsByCategory, reorderCategories, reorderProducts]);

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

  const handleOpenProductModal = (product?: Product, categoryId?: string) => {
    if (product) {
      setEditingProduct(product);
      const productImagesList = Array.isArray(product.images) ? product.images : [];
      setProductImages(productImagesList);
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
      setPreselectedCategoryId(null);
    } else {
      setEditingProduct(null);
      setProductImages([]);
      setSelectedModifierGroupIds([]);
      setPreselectedCategoryId(categoryId || null);
      productForm.reset({
        isAvailable: true,
        categoryId: categoryId || '',
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
    const submitData = {
      ...data,
      price: Number(data.price),
      currentStock: data.currentStock ? Number(data.currentStock) : 0,
      imageIds: productImages.map((img) => img.id),
    };

    if (editingProduct) {
      updateProduct(
        { id: editingProduct.id, data: submitData },
        {
          onSuccess: () => {
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
            setPreselectedCategoryId(null);
            productForm.reset();
          },
        }
      );
    } else {
      createProduct(submitData, {
        onSuccess: (newProduct) => {
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
          setPreselectedCategoryId(null);
          productForm.reset();
        },
      });
    }
  };

  const handleDeleteCategoryConfirm = (category: Category) => {
    if (confirm(t('menu.confirmDeleteCategory'))) {
      deleteCategory(category.id);
    }
  };

  const handleDeleteProductConfirm = (product: Product) => {
    if (confirm(t('menu.confirmDeleteItem'))) {
      deleteProduct(product.id);
    }
  };

  const handleSelectImagesFromLibrary = (images: ProductImage[]) => {
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
      // Error handled by mutation
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

  const isLoading = categoriesLoading || productsLoading;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-heading font-bold text-slate-900">{t('menu.title')}</h1>
        <p className="text-slate-500 mt-1">{t('menu.manageCategoriesAndProducts')}</p>
      </div>

      {/* Tabs */}
      <div className="mb-4 md:mb-6 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2 md:gap-4">
          <Button
            variant={activeTab === 'menu' ? 'primary' : 'outline'}
            onClick={() => setActiveTab('menu')}
            size="sm"
            className="md:text-base"
          >
            {t('menu.menuTab')}
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

        {/* Add Category button (only on menu tab) */}
        {activeTab === 'menu' && (
          <Button onClick={() => handleOpenCategoryModal()} disabled={!canAddCategory}>
            {canAddCategory ? (
              <Plus className="h-4 w-4 mr-2" />
            ) : (
              <Lock className="h-4 w-4 mr-2" />
            )}
            {t('menu.addCategory')}
          </Button>
        )}
      </div>

      {/* Menu Tab - Unified Categories & Products */}
      {activeTab === 'menu' && (
        <>
          {/* Limit Info Banners */}
          {(categoryLimit.limit !== -1 || productLimit.limit !== -1) && (
            <div className="space-y-3 mb-4">
              {categoryLimit.limit !== -1 && (
                <div className={`rounded-xl px-6 py-4 flex items-start gap-3 ${
                  canAddCategory
                    ? 'bg-blue-50 border border-blue-200'
                    : 'bg-amber-50 border border-amber-200'
                }`}>
                  <AlertTriangle className={`h-5 w-5 mt-0.5 ${canAddCategory ? 'text-blue-600' : 'text-amber-600'}`} />
                  <div>
                    <h3 className={`font-semibold text-sm ${canAddCategory ? 'text-blue-900' : 'text-amber-900'}`}>
                      {t('menu.categories')}: {categories?.length ?? 0} / {categoryLimit.limit}
                    </h3>
                  </div>
                </div>
              )}

              {productLimit.limit !== -1 && (
                <div className={`rounded-xl px-6 py-4 flex items-start gap-3 ${
                  canAddProduct
                    ? 'bg-blue-50 border border-blue-200'
                    : 'bg-amber-50 border border-amber-200'
                }`}>
                  <AlertTriangle className={`h-5 w-5 mt-0.5 ${canAddProduct ? 'text-blue-600' : 'text-amber-600'}`} />
                  <div>
                    <h3 className={`font-semibold text-sm ${canAddProduct ? 'text-blue-900' : 'text-amber-900'}`}>
                      {t('menu.items')}: {products?.length ?? 0} / {productLimit.limit}
                    </h3>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Upgrade Prompts */}
          {(!canAddCategory || !canAddProduct) && (
            <div className="mb-4">
              {!canAddCategory && (
                <UpgradePrompt
                  limitType="maxCategories"
                  currentCount={categories?.length ?? 0}
                  limit={categoryLimit.limit}
                />
              )}
              {!canAddProduct && canAddCategory && (
                <UpgradePrompt
                  limitType="maxProducts"
                  currentCount={products?.length ?? 0}
                  limit={productLimit.limit}
                />
              )}
            </div>
          )}

          {/* Drag to Reorder Info & Expand/Collapse Toggle */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-slate-500">
              {t('menu.dragToReorder')}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAllCategoriesExpanded(!allCategoriesExpanded)}
              className="text-slate-600"
            >
              <ChevronsUpDown className="h-4 w-4 mr-1" />
              {allCategoriesExpanded ? t('menu.collapseAll') : t('menu.expandAll')}
            </Button>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : sortedCategories.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Package className="mx-auto h-12 w-12 text-slate-400" />
                <h3 className="mt-4 text-lg font-medium text-slate-900">
                  {t('menu.noCategories')}
                </h3>
                <p className="mt-2 text-sm text-slate-500">
                  {t('menu.noCategoriesDesc')}
                </p>
                <Button
                  className="mt-4"
                  onClick={() => handleOpenCategoryModal()}
                  disabled={!canAddCategory}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t('menu.addCategory')}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="categories" type="CATEGORY">
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="space-y-4"
                  >
                    {sortedCategories.map((category, index) => (
                      <DraggableCategoryCard
                        key={category.id}
                        category={category}
                        products={productsByCategory[category.id] || []}
                        index={index}
                        onEditCategory={handleOpenCategoryModal}
                        onDeleteCategory={handleDeleteCategoryConfirm}
                        onAddProduct={(categoryId) => handleOpenProductModal(undefined, categoryId)}
                        onEditProduct={(product) => handleOpenProductModal(product)}
                        onDeleteProduct={handleDeleteProductConfirm}
                        defaultExpanded={allCategoriesExpanded}
                      />
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          )}

          {/* Uncategorized Products */}
          {uncategorizedProducts.length > 0 && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-amber-600">{t('menu.uncategorized')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-500 mb-4">
                  {t('menu.uncategorizedDesc')}
                </p>
                <div className="space-y-2">
                  {uncategorizedProducts.map((product) => (
                    <div
                      key={product.id}
                      className="flex items-center justify-between p-3 bg-amber-50 rounded-lg border border-amber-200"
                    >
                      <span className="font-medium">{product.name}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenProductModal(product)}
                      >
                        <Edit className="h-4 w-4 mr-1" />
                        {t('common:app.edit')}
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Image Library Tab - Minimal Design */}
      {activeTab === 'images' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar */}
          <div className="lg:col-span-1 space-y-4">
            {/* Upload Zone */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-medium text-slate-900 mb-3">Upload</h3>
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleImageDrop}
                className={cn(
                  'border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer',
                  isDragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-slate-400',
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
                    <Loader2 className="w-8 h-8 mx-auto text-slate-400 animate-spin" />
                  ) : (
                    <Upload className="w-8 h-8 mx-auto text-slate-400" />
                  )}
                  <p className="mt-2 text-sm text-slate-600">
                    {uploadImagesMutation.isPending ? t('menu.imageLibraryUI.uploading') : t('menu.imageLibraryUI.dropOrClick')}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">{t('menu.imageLibraryUI.uploadHint')}</p>
                </label>
              </div>
            </div>

            {/* Background Removal */}
            {bgRemovalSupported && (
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'w-8 h-8 rounded-lg flex items-center justify-center',
                      bgRemovalEnabled ? 'bg-violet-100' : 'bg-slate-100'
                    )}>
                      <Sparkles className={cn(
                        'w-4 h-4',
                        bgRemovalEnabled ? 'text-violet-600' : 'text-slate-400'
                      )} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-900">{t('menu.imageLibraryUI.removeBg')}</p>
                      <p className="text-xs text-slate-500">{t('menu.imageLibraryUI.aiPowered')}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setBgRemovalEnabled(!bgRemovalEnabled)}
                    disabled={isProcessing}
                    className={cn(
                      'relative w-10 h-5 rounded-full transition-colors',
                      bgRemovalEnabled ? 'bg-violet-600' : 'bg-slate-200'
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
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search..."
                  value={imageSearchTerm}
                  onChange={(e) => setImageSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {imageSearchTerm && (
                  <button onClick={() => setImageSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                    <X className="w-4 h-4 text-slate-400 hover:text-slate-600" />
                  </button>
                )}
              </div>
            </div>

            {/* View Toggle */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex gap-2">
                <button
                  onClick={() => setImageViewMode('grid')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm font-medium transition-colors',
                    imageViewMode === 'grid' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
                  )}
                >
                  <Grid3X3 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setImageViewMode('list')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm font-medium transition-colors',
                    imageViewMode === 'list' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
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
            <div className="bg-white rounded-xl border border-slate-200 min-h-[500px]">
              {imagesLoading ? (
                <div className="flex items-center justify-center h-96">
                  <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
                </div>
              ) : filteredImages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-96 text-center px-4">
                  <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                    <ImageIcon className="w-7 h-7 text-slate-400" />
                  </div>
                  <h3 className="text-base font-medium text-slate-900">
                    {imageSearchTerm ? t('menu.imageLibraryUI.noImagesFound') : t('menu.imageLibraryUI.noImagesYet')}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
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
                        'group relative aspect-square rounded-xl overflow-hidden cursor-pointer border-2 transition-all',
                        selectedImages.has(image.id)
                          ? 'border-blue-500 ring-2 ring-blue-500/20'
                          : 'border-transparent hover:border-slate-300'
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
                          : 'bg-white/80 border border-slate-300 opacity-0 group-hover:opacity-100'
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
                <div className="divide-y divide-slate-100">
                  {filteredImages.map((image) => (
                    <div
                      key={image.id}
                      onClick={() => toggleImageSelection(image.id)}
                      className={cn(
                        'flex items-center gap-4 p-3 cursor-pointer transition-colors',
                        selectedImages.has(image.id) ? 'bg-blue-50' : 'hover:bg-slate-50'
                      )}
                    >
                      <div className={cn(
                        'w-5 h-5 rounded border flex items-center justify-center flex-shrink-0',
                        selectedImages.has(image.id) ? 'bg-blue-500 border-blue-500' : 'border-slate-300'
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
                          <p className="text-sm font-medium text-slate-900 truncate">{image.filename}</p>
                          {image.filename.includes('_nobg') && (
                            <span className="px-1.5 py-0.5 bg-violet-100 text-violet-700 text-xs font-medium rounded">AI</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500">{(image.size / 1024).toFixed(1)} KB</p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteImage(image.id); }}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
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
                <Settings2 className="mx-auto h-12 w-12 text-slate-400" />
                <h3 className="mt-4 text-lg font-medium text-slate-900">
                  {t('menu.noModifierGroups')}
                </h3>
                <p className="mt-2 text-sm text-slate-500">
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
        size="sm"
      >
        <form
          onSubmit={categoryForm.handleSubmit(handleCategorySubmit)}
          className="space-y-3"
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
        onClose={() => {
          setProductModalOpen(false);
          setPreselectedCategoryId(null);
        }}
        title={editingProduct ? t('menu.editItem') : t('menu.addItem')}
        size="md"
      >
        <form
          onSubmit={productForm.handleSubmit(handleProductSubmit)}
          className="space-y-3"
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
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('menu.category')}
            </label>
            <select
              className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            <label className="block text-sm font-medium text-slate-700 mb-2">
              {t('menu.productImages')}
            </label>

            {/* Show selected images */}
            {productImages.length > 0 ? (
              <div className="mb-3">
                <div className="grid grid-cols-4 gap-2">
                  {productImages.map((image, index) => (
                    <div key={image.id} className="relative group">
                      <div className="aspect-square rounded-lg overflow-hidden border-2 border-slate-200">
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
              <div className="mb-4 text-center py-8 border-2 border-dashed border-slate-300 rounded-xl">
                <ImageIcon className="mx-auto h-10 w-10 text-slate-400" />
                <p className="mt-2 text-sm text-slate-600">{t('menu.noImagesSelected')}</p>
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
            <label className="block text-sm font-medium text-slate-700 mb-2">
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
              onClick={() => {
                setProductModalOpen(false);
                setPreselectedCategoryId(null);
              }}
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
