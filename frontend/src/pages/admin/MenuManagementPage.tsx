import { useState, useCallback, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { DragDropContext, Droppable, DropResult } from '@hello-pangea/dnd';
import {
  Plus,
  Edit,
  Trash2,
  Image as ImageIcon,
  Settings2,
  Lock,
  AlertTriangle,
  ChevronsUpDown,
  Package,
} from 'lucide-react';
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
import { ErrorState } from '../../components/ui/ErrorState';
import ImageLibraryModal from '../../components/product/ImageLibraryModal';
import { useSubscription } from '../../contexts/SubscriptionContext';
import UpgradePrompt from '../../components/subscriptions/UpgradePrompt';
import {
  createCategorySchema,
  createProductSchema,
  type CategoryFormData,
  type ProductFormData,
} from './menuManagement/menuSchemas';
import { reorder } from './menuManagement/reorder';
import { getImageUrl } from './menuManagement/imageUrl';
import ModifiersTab from './menuManagement/ModifiersTab';
import ImagesTab from './menuManagement/ImagesTab';

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

  const {
    data: categories,
    isLoading: categoriesLoading,
    isError: categoriesError,
    error: categoriesErrorObj,
    refetch: refetchCategories,
  } = useCategories();
  const {
    data: products,
    isLoading: productsLoading,
    isError: productsError,
    error: productsErrorObj,
    refetch: refetchProducts,
  } = useProducts();

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
          <Button onClick={() => handleOpenCategoryModal()} disabled={!canAddCategory} data-tour="add-category">
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
          ) : categoriesError || productsError ? (
            // A failed menu fetch used to fall through to the "no
            // categories" empty state — surface the failure instead.
            <Card>
              <ErrorState
                error={categoriesError ? categoriesErrorObj : productsErrorObj}
                onRetry={() => {
                  if (categoriesError) refetchCategories();
                  if (productsError) refetchProducts();
                }}
              />
            </Card>
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
                    data-tour="product-list"
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
      {activeTab === 'images' && <ImagesTab />}

      {/* Modifiers Tab */}
      {activeTab === 'modifiers' && (
        <ModifiersTab
          modifierGroups={modifierGroups}
          modifierGroupsLoading={modifierGroupsLoading}
          onAddGroup={() => handleOpenModifierGroupModal()}
          onEditGroup={handleOpenModifierGroupModal}
          onDeleteGroup={handleDeleteModifierGroup}
          onAddModifier={(groupId) => handleOpenModifierItemModal(groupId)}
          onEditModifier={(modifier) => handleOpenModifierItemModal(modifier.groupId, modifier)}
          onDeleteModifier={handleDeleteModifier}
        />
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
                          src={getImageUrl(image.url)}
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
