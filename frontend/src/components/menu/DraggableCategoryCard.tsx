import React, { useState, useEffect } from 'react';
import { Draggable, Droppable } from '@hello-pangea/dnd';
import { GripVertical, Edit, Trash2, Plus, ChevronDown, ChevronRight, Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Category, Product } from '../../types';
import { cn } from '../../lib/utils';
import Button from '../ui/Button';
import DraggableProductItem from './DraggableProductItem';

interface DraggableCategoryCardProps {
  category: Category;
  products: Product[];
  index: number;
  onEditCategory: (category: Category) => void;
  onDeleteCategory: (category: Category) => void;
  onAddProduct: (categoryId: string) => void;
  onEditProduct: (product: Product) => void;
  onDeleteProduct: (product: Product) => void;
  defaultExpanded?: boolean;
}

const DraggableCategoryCard: React.FC<DraggableCategoryCardProps> = ({
  category,
  products,
  index,
  onEditCategory,
  onDeleteCategory,
  onAddProduct,
  onEditProduct,
  onDeleteProduct,
  defaultExpanded = true,
}) => {
  const { t } = useTranslation(['menu', 'common']);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Sync with parent's expand/collapse all toggle
  useEffect(() => {
    setIsExpanded(defaultExpanded);
  }, [defaultExpanded]);

  const sortedProducts = [...products].sort((a, b) => {
    const orderA = a.displayOrder ?? 0;
    const orderB = b.displayOrder ?? 0;
    return orderA - orderB;
  });

  return (
    <Draggable draggableId={category.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={cn(
            'bg-white rounded-xl border transition-all',
            snapshot.isDragging
              ? 'shadow-xl ring-2 ring-blue-500 border-blue-500'
              : 'border-slate-200 hover:border-slate-300'
          )}
        >
          {/* Category Header */}
          <div className="flex items-center gap-3 p-4 border-b border-slate-100">
            {/* Drag Handle */}
            <div
              {...provided.dragHandleProps}
              className="flex-shrink-0 p-1 cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600"
            >
              <GripVertical className="h-5 w-5" />
            </div>

            {/* Expand/Collapse Toggle */}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex-shrink-0 p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded"
            >
              {isExpanded ? (
                <ChevronDown className="h-5 w-5" />
              ) : (
                <ChevronRight className="h-5 w-5" />
              )}
            </button>

            {/* Category Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-slate-900">{category.name}</h3>
                <span className="text-sm text-slate-500">
                  ({products.length} {products.length === 1 ? t('menu.item') : t('menu.items')})
                </span>
              </div>
              {category.description && (
                <p className="text-sm text-slate-500 truncate">{category.description}</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex-shrink-0 flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onAddProduct(category.id)}
                className="h-8"
              >
                <Plus className="h-4 w-4 mr-1" />
                {t('menu.addItem')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEditCategory(category)}
                className="h-8 w-8 p-0"
              >
                <Edit className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDeleteCategory(category)}
                className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Products List (Collapsible) */}
          {isExpanded && (
            <Droppable droppableId={`products-${category.id}`} type="PRODUCT">
              {(droppableProvided, droppableSnapshot) => (
                <div
                  ref={droppableProvided.innerRef}
                  {...droppableProvided.droppableProps}
                  className={cn(
                    'p-3 space-y-2 min-h-[60px] transition-colors',
                    droppableSnapshot.isDraggingOver && 'bg-blue-50'
                  )}
                >
                  {sortedProducts.length > 0 ? (
                    sortedProducts.map((product, productIndex) => (
                      <DraggableProductItem
                        key={product.id}
                        product={product}
                        index={productIndex}
                        onEdit={onEditProduct}
                        onDelete={onDeleteProduct}
                      />
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                      <Package className="h-8 w-8 mb-2" />
                      <p className="text-sm">{t('menu.noProductsInCategory')}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onAddProduct(category.id)}
                        className="mt-3"
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        {t('menu.addProductToCategory')}
                      </Button>
                    </div>
                  )}
                  {droppableProvided.placeholder}
                </div>
              )}
            </Droppable>
          )}
        </div>
      )}
    </Draggable>
  );
};

export default DraggableCategoryCard;
