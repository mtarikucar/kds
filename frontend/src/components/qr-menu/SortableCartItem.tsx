import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2, Plus, Minus, MessageSquare } from 'lucide-react';
import { CartItem } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { cn } from '../../lib/utils';

interface SortableCartItemProps {
  item: CartItem;
  currency: string;
  primaryColor: string;
  secondaryColor: string;
  onUpdateQuantity: (itemId: string, quantity: number) => void;
  onRemove: (itemId: string) => void;
  isDragging?: boolean;
}

const SortableCartItem: React.FC<SortableCartItemProps> = ({
  item,
  currency,
  primaryColor,
  secondaryColor,
  onUpdateQuantity,
  onRemove,
  isDragging = false,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isSortableDragging ? 50 : 'auto',
  };

  const isCurrentlyDragging = isDragging || isSortableDragging;

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        borderLeftColor: primaryColor,
        borderRightColor: primaryColor,
      }}
      className={cn(
        'bg-white rounded-2xl shadow-lg p-4 transition-all duration-200 border-l-4 rtl:border-l-0 rtl:border-r-4',
        isCurrentlyDragging && 'shadow-2xl scale-[1.02] opacity-90 ring-2 ring-offset-2',
        !isCurrentlyDragging && 'hover:shadow-xl'
      )}
      {...attributes}
    >
      <div className="flex gap-3">
        {/* Drag Handle */}
        <div
          {...listeners}
          className="flex-shrink-0 flex items-center cursor-grab active:cursor-grabbing touch-none"
          style={{ color: primaryColor }}
        >
          <GripVertical className="h-5 w-5 opacity-50 hover:opacity-100 transition-opacity" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-base mb-1 truncate" style={{ color: secondaryColor }}>
            {item.product.name}
          </h3>
          <p className="text-sm font-semibold mb-2" style={{ color: primaryColor }}>
            {formatCurrency(item.product.price, currency)}
          </p>

          {/* Modifiers */}
          {item.modifiers.length > 0 && (
            <div className="space-y-1 mb-3 p-2 bg-slate-50 rounded-lg">
              {item.modifiers.map(mod => (
                <div key={mod.id} className="text-xs text-slate-600 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full" style={{ backgroundColor: primaryColor }}></span>
                    {mod.displayName}
                  </span>
                  {mod.priceAdjustment > 0 && (
                    <span className="font-semibold text-green-600">
                      +{formatCurrency(mod.priceAdjustment, currency)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Notes */}
          {item.notes && (
            <div className="text-sm text-slate-600 flex items-start gap-2 mb-3 p-2 bg-blue-50 rounded-lg">
              <MessageSquare className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: primaryColor }} />
              <span className="italic text-xs">{item.notes}</span>
            </div>
          )}

          {/* Quantity Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
              className="p-2.5 rounded-lg border-2 transition-all hover:scale-110 active:scale-95 min-w-[40px] min-h-[40px] flex items-center justify-center"
              style={{ borderColor: primaryColor, color: primaryColor }}
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-8 text-center font-bold text-base" style={{ color: secondaryColor }}>
              {item.quantity}
            </span>
            <button
              onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
              className="p-2.5 rounded-lg border-2 transition-all hover:scale-110 active:scale-95 min-w-[40px] min-h-[40px] flex items-center justify-center"
              style={{ borderColor: primaryColor, color: primaryColor }}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Price and Delete */}
        <div className="flex flex-col items-end justify-between">
          <span className="font-bold text-base" style={{ color: primaryColor }}>
            {formatCurrency(item.itemTotal, currency)}
          </span>
          <button
            onClick={() => onRemove(item.id)}
            className="p-2 rounded-lg hover:bg-red-50 transition-all active:scale-95"
          >
            <Trash2 className="h-5 w-5 text-red-500" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default SortableCartItem;
