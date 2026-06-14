import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Trash2,
  Image as ImageIcon,
  Settings2,
  Lock,
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
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import ImageLibraryModal from '../../components/product/ImageLibraryModal';
import { useSubscription } from '../../contexts/SubscriptionContext';
import {
  createCategorySchema,
  createProductSchema,
  type CategoryFormData,
  type ProductFormData,
} from './menuManagement/menuSchemas';
import { getImageUrl } from './menuManagement/imageUrl';
import ModifiersTab from './menuManagement/ModifiersTab';
import ImagesTab from './menuManagement/ImagesTab';
import MenuTab from './menuManagement/MenuTab';

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
        <MenuTab
          categories={categories}
          products={products}
          isLoading={isLoading}
          categoriesError={categoriesError}
          productsError={productsError}
          categoriesErrorObj={categoriesErrorObj}
          productsErrorObj={productsErrorObj}
          refetchCategories={refetchCategories}
          refetchProducts={refetchProducts}
          categoryLimit={categoryLimit}
          productLimit={productLimit}
          canAddCategory={canAddCategory}
          canAddProduct={canAddProduct}
          allCategoriesExpanded={allCategoriesExpanded}
          onToggleExpandAll={() => setAllCategoriesExpanded(!allCategoriesExpanded)}
          onAddCategory={() => handleOpenCategoryModal()}
          onEditCategory={handleOpenCategoryModal}
          onDeleteCategory={handleDeleteCategoryConfirm}
          onAddProduct={(categoryId) => handleOpenProductModal(undefined, categoryId)}
          onEditProduct={(product) => handleOpenProductModal(product)}
          onDeleteProduct={handleDeleteProductConfirm}
        />
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
