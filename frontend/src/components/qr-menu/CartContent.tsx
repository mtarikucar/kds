import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion';
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
import { GripVertical, ArrowLeft, ShoppingBag } from 'lucide-react';
import { formatCurrency, cn } from '../../lib/utils';
import { useCartStore } from '../../store/cartStore';
import { MenuSettings } from '../../pages/qr-menu/QRMenuLayout';
import { buildQRMenuUrl } from '../../utils/subdomain';
import SortableCartItem from './SortableCartItem';
import SwipeableCartItem from './SwipeableCartItem';
import EmptyCart from './EmptyCart';
import { useIsRTL } from './RTLIcon';

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

// Animated number component
const AnimatedNumber: React.FC<{ value: number; currency: string; className?: string; style?: React.CSSProperties }> = ({
  value,
  currency,
  className,
  style,
}) => {
  const [displayValue, setDisplayValue] = useState(value);
  const prevValue = useRef(value);

  useEffect(() => {
    if (prevValue.current !== value) {
      const controls = animate(prevValue.current, value, {
        duration: 0.4,
        ease: 'easeOut',
        onUpdate: (v) => setDisplayValue(v),
      });
      prevValue.current = value;
      return () => controls.stop();
    }
  }, [value]);

  return (
    <span className={className} style={style}>
      {formatCurrency(displayValue, currency)}
    </span>
  );
};

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
  const isRTL = useIsRTL();
  const { items, updateItemQuantity, removeItem, reorderItems, getSubtotal, getTotal, sessionId } = useCartStore();
  const [specialNotes, setSpecialNotes] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Check if on mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

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
      <div className="px-4 sm:px-6 py-8 mb-20 md:mb-0">
        <div className="max-w-md mx-auto">
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
    <div className="px-4 sm:px-6 py-6 pb-52 md:pb-6">
      <div className="max-w-lg mx-auto">
        {/* Back to Menu Button */}
        <motion.button
          onClick={handleBrowseMenu}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 mb-4 transition-colors"
          whileTap={{ scale: 0.98 }}
        >
          <ArrowLeft className="h-4 w-4 rtl-flip" />
          {t('cart.continueShopping', 'Continue Shopping')}
        </motion.button>

        {/* Cart Header */}
        <div className="flex items-center gap-3 mb-5">
          <div
            className="p-2.5 rounded-xl"
            style={{ backgroundColor: `${settings.primaryColor}15` }}
          >
            <ShoppingBag className="h-5 w-5" style={{ color: settings.primaryColor }} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {t('cart.title', 'Your Cart')}
            </h2>
            <p className="text-sm text-slate-500">
              {items.length} {items.length === 1 ? t('cart.item', 'item') : t('cart.items', 'items')}
            </p>
          </div>
        </div>

        {/* Hint for drag/swipe */}
        <AnimatePresence>
          {items.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center justify-center gap-2 text-xs text-slate-400 mb-4"
            >
              {isMobile ? (
                <span>{t('cart.swipeToDelete', 'Swipe left to delete')}</span>
              ) : items.length > 1 ? (
                <>
                  <GripVertical className="h-3.5 w-3.5" />
                  <span>{t('cart.dragToReorder', 'Drag items to reorder')}</span>
                </>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Cart Items with DnD */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-3 mb-6">
              <AnimatePresence mode="popLayout">
                {items.map((item, index) => (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, x: isRTL ? 20 : -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: isRTL ? -100 : 100, transition: { duration: 0.2 } }}
                    transition={{ delay: index * 0.05 }}
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
              </AnimatePresence>
            </div>
          </SortableContext>
        </DndContext>

        {/* Special Notes */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 mb-6"
        >
          <label className="block text-sm font-semibold text-slate-700 mb-2">
            {t('cart.specialNotes', 'Special Notes')}
          </label>
          <textarea
            value={specialNotes}
            onChange={(e) => setSpecialNotes(e.target.value)}
            placeholder={t('cart.notesPlaceholder', 'Any special requests for your order?')}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-opacity-50 focus:border-transparent resize-none text-sm transition-all"
            style={{ '--tw-ring-color': settings.primaryColor } as React.CSSProperties}
            rows={2}
          />
        </motion.div>
      </div>

      {/* Sticky Order Summary */}
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="fixed bottom-20 md:bottom-0 left-0 right-0 z-30 md:relative md:max-w-lg md:mx-auto"
      >
        <div
          className="mx-4 md:mx-0 rounded-2xl shadow-xl overflow-hidden"
          style={{
            background: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          {/* Top Accent */}
          <div
            className="h-1"
            style={{
              background: `linear-gradient(90deg, ${settings.primaryColor}, ${settings.secondaryColor})`,
            }}
          />

          <div
            className="p-4"
            style={{
              paddingBottom: isMobile ? 'calc(1rem + env(safe-area-inset-bottom, 0px))' : '1rem',
            }}
          >
            {/* Summary */}
            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-sm text-slate-600">
                <span>{t('cart.subtotal', 'Subtotal')}</span>
                <AnimatedNumber value={getSubtotal()} currency={currency} />
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                <span className="font-bold text-slate-900">{t('cart.total', 'Total')}</span>
                <AnimatedNumber
                  value={getTotal()}
                  currency={currency}
                  className="text-xl font-black"
                  style={{ color: settings.primaryColor }}
                />
              </div>
            </div>

            {/* Submit Button */}
            <motion.button
              onClick={onSubmitOrder}
              disabled={isSubmitting}
              className={cn(
                'w-full py-4 rounded-xl font-bold text-white transition-all duration-200 flex items-center justify-center gap-2',
                isSubmitting && 'opacity-70'
              )}
              style={{
                backgroundColor: settings.primaryColor,
                boxShadow: `0 4px 15px ${settings.primaryColor}40`,
              }}
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
                <>
                  <ShoppingBag className="w-5 h-5" />
                  {t('cart.placeOrder', 'Place Order')}
                </>
              )}
            </motion.button>

            {enableCustomerOrdering && (
              <p className="text-xs text-center text-slate-400 mt-3">
                {t('cart.approvalNote', 'Your order will be sent to staff for approval')}
              </p>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default CartContent;
