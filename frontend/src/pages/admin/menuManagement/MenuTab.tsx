import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DragDropContext, Droppable, DropResult } from '@hello-pangea/dnd';
import { Plus, Edit, AlertTriangle, ChevronsUpDown, Package } from 'lucide-react';
import {
  useReorderCategories,
  useReorderProducts,
} from '../../../features/menu/menuApi';
import { Category, Product } from '../../../types';
import { DraggableCategoryCard } from '../../../components/menu';
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import Spinner from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import UpgradePrompt from '../../../components/subscriptions/UpgradePrompt';
import { reorder } from './reorder';

// Presentational extraction of the "menu" activeTab branch from
// MenuManagementPage. The drag-and-drop reorder logic and the
// category/product derived state (sort, group-by-category, uncategorized)
// move here, since they derive purely from the categories/products props plus
// the reorder mutations. The shared category/product modals (and their forms)
// stay in the parent — this tab only opens them through the on* handlers.
// Rendered markup is identical to the inline version.
interface MenuTabProps {
  categories: Category[] | undefined;
  products: Product[] | undefined;
  isLoading: boolean;
  categoriesError: boolean;
  productsError: boolean;
  categoriesErrorObj: unknown;
  productsErrorObj: unknown;
  refetchCategories: () => void;
  refetchProducts: () => void;
  categoryLimit: { limit: number };
  productLimit: { limit: number };
  canAddCategory: boolean;
  canAddProduct: boolean;
  allCategoriesExpanded: boolean;
  onToggleExpandAll: () => void;
  onAddCategory: () => void;
  onEditCategory: (category: Category) => void;
  onDeleteCategory: (category: Category) => void;
  onAddProduct: (categoryId: string) => void;
  onEditProduct: (product: Product) => void;
  onDeleteProduct: (product: Product) => void;
}

const MenuTab = ({
  categories,
  products,
  isLoading,
  categoriesError,
  productsError,
  categoriesErrorObj,
  productsErrorObj,
  refetchCategories,
  refetchProducts,
  categoryLimit,
  productLimit,
  canAddCategory,
  canAddProduct,
  allCategoriesExpanded,
  onToggleExpandAll,
  onAddCategory,
  onEditCategory,
  onDeleteCategory,
  onAddProduct,
  onEditProduct,
  onDeleteProduct,
}: MenuTabProps) => {
  const { t } = useTranslation(['menu', 'common']);

  // Reorder mutations
  const { mutate: reorderCategories } = useReorderCategories();
  const { mutate: reorderProducts } = useReorderProducts();

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

  return (
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
          onClick={onToggleExpandAll}
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
              onClick={onAddCategory}
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
                    onEditCategory={onEditCategory}
                    onDeleteCategory={onDeleteCategory}
                    onAddProduct={(categoryId) => onAddProduct(categoryId)}
                    onEditProduct={(product) => onEditProduct(product)}
                    onDeleteProduct={onDeleteProduct}
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
                    onClick={() => onEditProduct(product)}
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
  );
};

export default MenuTab;
