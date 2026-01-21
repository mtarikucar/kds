import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Trash2, Plus, Minus, MessageSquare, GripVertical } from 'lucide-react';
import { formatCurrency, cn } from '../../lib/utils';
import { useCartStore } from '../../store/cartStore';
import { MenuSettings } from '../../pages/qr-menu/QRMenuLayout';
import { buildQRMenuUrl } from '../../utils/subdomain';
import SortableCartItem from './SortableCartItem';
import SwipeableCartItem from './SwipeableCartItem';
import EmptyCart from './EmptyCart';

interface CartContentProps {
  settings: MenuSettings;
  enableCustomerOrdering: boolean;
  currency: string;
  onSubmitOrder: () => void;
  onShowTableSelection: () => void;
  isSubmitting: boolean;
  tenantId?: string;
  tableId?: string | null;
  subdomain?: string;
}

const CartContent: React.FC<CartContentProps> = ({
  settings,
  enableCustomerOrdering,
  currency,
  onSubmitOrder,
  onShowTableSelection,
  isSubmitting,
  tenantId,
  tableId,
  subdomain,
}) => {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { items, updateItemQuantity, removeItem, reorderItems, getSubtotal, getTotal, sessionId } = useCartStore();
  const [specialNotes, setSpecialNotes] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);

  // Check if on mobile
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const itemIds = useMemo(() => items.map(item => item.id), [items]);

  const handleDragStart = (event: DragEndEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (over && active.id !== over.id) {
      reorderItems(active.id as string, over.id as string);
    }
  };

  const handleBrowseMenu = () => {
    const url = buildQRMenuUrl('menu', {
      subdomain,
      tenantId,
      tableId,
      sessionId,
    });
    navigate(url);
  };

  if (items.length === 0) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 mb-20 md:mb-0">
        <div className="max-w-2xl mx-auto">
          <EmptyCart
            primaryColor={settings.primaryColor}
            secondaryColor={settings.secondaryColor}
            onBrowseMenu={handleBrowseMenu}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 pb-48 md:pb-6">
      <div className="max-w-2xl mx-auto">
        {/* Drag hint for desktop */}
        {!isMobile && items.length > 1 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 text-xs text-slate-500 mb-4 px-2"
          >
            <GripVertical className="h-4 w-4" />
            <span>{t('cart.dragToReorder', 'Drag items to reorder')}</span>
          </motion.div>
        )}

        {/* Swipe hint for mobile */}
        {isMobile && items.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-center gap-2 text-xs text-slate-500 mb-4"
          >
            <span>{t('cart.swipeToDelete', 'Swipe left to delete')}</span>
          </motion.div>
        )}

        {/* Cart Items with DnD */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-3 mb-6">
              {items.map((item, index) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  style={{ borderLeftColor: settings.primaryColor }}
                >
                  {isMobile ? (
                    <SwipeableCartItem onDelete={() => removeItem(item.id)}>
                      <SortableCartItem
                        item={item}
                        currency={currency}
                        primaryColor={settings.primaryColor}
                        secondaryColor={settings.secondaryColor}
                        onUpdateQuantity={updateItemQuantity}
                        onRemove={removeItem}
                        isDragging={activeId === item.id}
                      />
                    </SwipeableCartItem>
                  ) : (
                    <SortableCartItem
                      item={item}
                      currency={currency}
                      primaryColor={settings.primaryColor}
                      secondaryColor={settings.secondaryColor}
                      onUpdateQuantity={updateItemQuantity}
                      onRemove={removeItem}
                      isDragging={activeId === item.id}
                    />
                  )}
                </motion.div>
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {/* Special Notes */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-2xl shadow-md p-4 mb-6"
        >
          <label className="block text-sm font-semibold mb-2" style={{ color: settings.secondaryColor }}>
            {t('cart.specialNotes', 'Special Notes')}
          </label>
          <textarea
            value={specialNotes}
            onChange={(e) => setSpecialNotes(e.target.value)}
            placeholder={t('cart.notesPlaceholder', 'Any special requests?')}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-opacity-50 focus:border-transparent resize-none transition-all"
            style={{ '--tw-ring-color': settings.primaryColor } as React.CSSProperties}
            rows={3}
          />
        </motion.div>
      </div>

      {/* Sticky Order Summary */}
      <div className="fixed bottom-20 md:bottom-0 left-0 right-0 z-30 md:relative md:max-w-2xl md:mx-auto">
        <div
          className="bg-white/95 backdrop-blur-lg rounded-t-3xl md:rounded-2xl shadow-2xl border-t md:border border-slate-200/50 p-4 md:p-6"
          style={{
            paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
          }}
        >
          {/* Summary */}
          <div className="space-y-2 mb-4">
            <div className="flex justify-between text-sm text-slate-600">
              <span>{t('cart.subtotal', 'Subtotal')}</span>
              <span>{formatCurrency(getSubtotal(), currency)}</span>
            </div>
            <div className="flex justify-between font-bold text-lg" style={{ color: settings.primaryColor }}>
              <span>{t('cart.total', 'Total')}</span>
              <span>{formatCurrency(getTotal(), currency)}</span>
            </div>
          </div>

          {/* Submit Button */}
          <motion.button
            onClick={onSubmitOrder}
            disabled={isSubmitting}
            className={cn(
              'w-full py-4 rounded-2xl font-bold text-white transition-all duration-200',
              isSubmitting && 'opacity-70'
            )}
            style={{ backgroundColor: settings.primaryColor }}
            whileTap={{ scale: 0.98 }}
            whileHover={{ scale: 1.01 }}
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                  className="w-5 h-5 border-2 border-white border-t-transparent rounded-full"
                />
                {t('cart.submitting', 'Placing order...')}
              </span>
            ) : (
              t('cart.placeOrder', 'Place Order')
            )}
          </motion.button>

          {enableCustomerOrdering && (
            <p className="text-xs text-center text-slate-500 mt-3">
              {t('cart.approvalNote', 'Your order will be sent to staff for approval')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default CartContent;
