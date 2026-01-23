import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { X, UtensilsCrossed, Plus, Minus, ShoppingCart, Check, ChevronDown } from 'lucide-react';
import { Product, ModifierGroup, Modifier, CartModifier, SelectionType } from '../../types';
import { formatCurrency, cn } from '../../lib/utils';
import { useCartStore } from '../../store/cartStore';
import ProductImageGallery from '../../components/qr-menu/ProductImageGallery';
import BottomSheet from '../../components/qr-menu/BottomSheet';

interface ProductDetailModalWithCartProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
  primaryColor: string;
  secondaryColor: string;
  showImages: boolean;
  showDescription: boolean;
  showPrices: boolean;
  enableCustomerOrdering: boolean;
  currency?: string;
}

const ProductDetailModalWithCart: React.FC<ProductDetailModalWithCartProps> = ({
  isOpen,
  onClose,
  product,
  primaryColor,
  secondaryColor,
  showImages,
  showDescription,
  showPrices,
  enableCustomerOrdering,
  currency = 'TRY',
}) => {
  const { t } = useTranslation('common');
  const addItem = useCartStore(state => state.addItem);

  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [selectedModifiers, setSelectedModifiers] = useState<Map<string, CartModifier[]>>(new Map());
  const [showSuccess, setShowSuccess] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen && product) {
      setQuantity(1);
      setNotes('');
      setSelectedModifiers(new Map());
      setShowSuccess(false);
      const requiredGroups = new Set(
        product.modifierGroups
          ?.filter(g => g.isRequired || g.minSelections > 0)
          .map(g => g.id) || []
      );
      setExpandedGroups(requiredGroups);
    }
  }, [isOpen, product]);

  if (!product) return null;

  const normalizeImageUrl = (url: string | null | undefined): string | null => {
    if (!url) return null;
    const normalizedPath = url.replace(/\\/g, '/');
    if (normalizedPath.startsWith('http://') || normalizedPath.startsWith('https://')) {
      return normalizedPath;
    }
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
    const BASE_URL = API_URL.replace(/\/api$/, '');
    const path = normalizedPath.startsWith('/') ? normalizedPath.substring(1) : normalizedPath;
    return `${BASE_URL}/${path}`;
  };

  const productImages = product.images?.length
    ? product.images.map(img => ({ url: img.url, alt: product.name }))
    : product.image
      ? [{ url: product.image, alt: product.name }]
      : [];

  const toggleGroupExpanded = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const handleModifierToggle = (group: ModifierGroup, modifier: Modifier) => {
    const newSelectedModifiers = new Map(selectedModifiers);
    const groupModifiers = newSelectedModifiers.get(group.id) || [];
    const existingIndex = groupModifiers.findIndex(m => m.id === modifier.id);

    if (group.selectionType === SelectionType.SINGLE) {
      if (existingIndex !== -1) {
        newSelectedModifiers.set(group.id, []);
      } else {
        newSelectedModifiers.set(group.id, [{
          id: modifier.id,
          name: modifier.name,
          displayName: modifier.displayName,
          priceAdjustment: modifier.priceAdjustment,
          quantity: 1,
        }]);
      }
    } else {
      if (existingIndex !== -1) {
        const updated = groupModifiers.filter(m => m.id !== modifier.id);
        newSelectedModifiers.set(group.id, updated);
      } else {
        if (group.maxSelections && groupModifiers.length >= group.maxSelections) {
          return;
        }
        newSelectedModifiers.set(group.id, [
          ...groupModifiers,
          {
            id: modifier.id,
            name: modifier.name,
            displayName: modifier.displayName,
            priceAdjustment: modifier.priceAdjustment,
            quantity: 1,
          },
        ]);
      }
    }

    setSelectedModifiers(newSelectedModifiers);
  };

  const isModifierSelected = (groupId: string, modifierId: string): boolean => {
    const groupModifiers = selectedModifiers.get(groupId) || [];
    return groupModifiers.some(m => m.id === modifierId);
  };

  const getGroupSelectionCount = (groupId: string): number => {
    return (selectedModifiers.get(groupId) || []).length;
  };

  const canAddToCart = (): boolean => {
    if (!product.modifierGroups) return true;

    for (const group of product.modifierGroups) {
      if (group.isRequired) {
        const groupModifiers = selectedModifiers.get(group.id) || [];
        if (groupModifiers.length < group.minSelections) {
          return false;
        }
      }
    }
    return true;
  };

  const calculateTotal = (): number => {
    let total = product.price;
    selectedModifiers.forEach(modifiers => {
      modifiers.forEach(mod => {
        total += mod.priceAdjustment * mod.quantity;
      });
    });
    return total * quantity;
  };

  const handleAddToCart = () => {
    if (!canAddToCart()) return;

    const allModifiers: CartModifier[] = [];
    selectedModifiers.forEach(modifiers => {
      allModifiers.push(...modifiers);
    });

    addItem(product, quantity, allModifiers, notes || undefined);

    setShowSuccess(true);
    setTimeout(() => {
      setShowSuccess(false);
      setTimeout(() => {
        onClose();
      }, 300);
    }, 1200);
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      {/* Product Image */}
      {showImages && (
        <div className="relative w-full aspect-[4/3] bg-gradient-to-br from-slate-100 to-slate-200">
          {productImages.length > 0 ? (
            <ProductImageGallery
              images={productImages}
              className="h-full"
              showThumbnails={productImages.length > 1}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <UtensilsCrossed className="h-16 w-16 text-slate-300" />
            </div>
          )}

          {/* Close Button */}
          <motion.button
            onClick={onClose}
            className="absolute top-4 right-4 rtl:right-auto rtl:left-4 z-10 p-2 rounded-full bg-white/90 hover:bg-white shadow-lg transition-all"
            whileTap={{ scale: 0.9 }}
          >
            <X className="h-5 w-5 text-slate-600" />
          </motion.button>
        </div>
      )}

      {/* Content */}
      <div className="p-5">
        {/* Close button when no image */}
        {!showImages && (
          <motion.button
            onClick={onClose}
            className="absolute top-4 right-4 rtl:right-auto rtl:left-4 z-10 p-2 rounded-full bg-slate-100 hover:bg-slate-200 transition-colors"
            whileTap={{ scale: 0.9 }}
          >
            <X className="h-5 w-5 text-slate-600" />
          </motion.button>
        )}

        {/* Product Name & Price */}
        <div className="mb-4">
          <h2
            className="text-xl font-bold leading-tight mb-2 pr-10 rtl:pr-0 rtl:pl-10"
            style={{ color: secondaryColor }}
          >
            {product.name}
          </h2>

          {showPrices && (
            <p
              className="text-2xl font-black"
              style={{ color: primaryColor }}
            >
              {formatCurrency(product.price, currency)}
            </p>
          )}
        </div>

        {/* Description */}
        {showDescription && product.description && (
          <p className="text-slate-600 text-sm leading-relaxed mb-5">
            {product.description}
          </p>
        )}

        {/* Modifier Groups - Accordion Style */}
        {product.modifierGroups && product.modifierGroups.length > 0 && (
          <div className="space-y-3 mb-5">
            {product.modifierGroups.map(group => {
              const isExpanded = expandedGroups.has(group.id);
              const selectionCount = getGroupSelectionCount(group.id);

              return (
                <div
                  key={group.id}
                  className="border border-slate-200 rounded-2xl overflow-hidden"
                >
                  {/* Accordion Header */}
                  <button
                    onClick={() => toggleGroupExpanded(group.id)}
                    className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 transition-colors"
                  >
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-slate-900">
                          {group.displayName}
                        </h3>
                        {group.isRequired && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600">
                            {t('qrMenu.required', 'Required')}
                          </span>
                        )}
                        {selectionCount > 0 && (
                          <span
                            className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
                            style={{ backgroundColor: primaryColor }}
                          >
                            {selectionCount}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {group.selectionType === SelectionType.SINGLE
                          ? t('qrMenu.selectOne', 'Select one')
                          : group.maxSelections
                            ? t('qrMenu.selectUpTo', `Select up to ${group.maxSelections}`, { max: group.maxSelections })
                            : t('qrMenu.selectMultiple', 'Select multiple')}
                      </p>
                    </div>
                    <motion.div
                      animate={{ rotate: isExpanded ? 180 : 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <ChevronDown className="h-5 w-5 text-slate-400" />
                    </motion.div>
                  </button>

                  {/* Accordion Content - Chips */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="p-4 pt-2 flex flex-wrap gap-2">
                          {group.modifiers.map(modifier => {
                            const selected = isModifierSelected(group.id, modifier.id);
                            return (
                              <motion.button
                                key={modifier.id}
                                onClick={() => handleModifierToggle(group, modifier)}
                                className={cn(
                                  'px-4 py-2 rounded-full text-sm font-medium transition-all border-2',
                                  selected
                                    ? 'border-transparent text-white'
                                    : 'border-slate-200 text-slate-700 hover:border-slate-300 bg-white'
                                )}
                                style={{
                                  backgroundColor: selected ? primaryColor : undefined,
                                }}
                                whileTap={{ scale: 0.95 }}
                              >
                                <span className="flex items-center gap-2">
                                  {selected && <Check className="h-3.5 w-3.5" />}
                                  {modifier.displayName}
                                  {modifier.priceAdjustment > 0 && (
                                    <span className={cn(
                                      'text-xs',
                                      selected ? 'text-white/80' : 'text-green-600'
                                    )}>
                                      +{formatCurrency(modifier.priceAdjustment, currency)}
                                    </span>
                                  )}
                                </span>
                              </motion.button>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}

        {/* Notes */}
        {enableCustomerOrdering && (
          <div className="mb-5">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              {t('qrMenu.specialInstructions', 'Special Instructions')}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('qrMenu.notesPlaceholder', 'E.g., No onions, extra sauce...')}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-opacity-50 focus:border-transparent resize-none text-sm transition-all"
              style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
              rows={2}
            />
          </div>
        )}
      </div>

      {/* Sticky Footer - Quantity + Add to Cart */}
      {enableCustomerOrdering && (
        <div
          className="sticky bottom-0 bg-white border-t border-slate-100 p-4"
          style={{
            paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
          }}
        >
          <div className="flex items-center gap-3">
            {/* Quantity Stepper */}
            <div className="flex items-center bg-slate-100 rounded-xl">
              <motion.button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                disabled={quantity <= 1}
                className="p-3 disabled:opacity-40"
                whileTap={{ scale: 0.9 }}
              >
                <Minus className="w-4 h-4 text-slate-600" />
              </motion.button>
              <span className="w-8 text-center font-bold text-slate-900">{quantity}</span>
              <motion.button
                onClick={() => setQuantity(quantity + 1)}
                className="p-3"
                whileTap={{ scale: 0.9 }}
              >
                <Plus className="w-4 h-4 text-slate-600" />
              </motion.button>
            </div>

            {/* Add to Cart Button */}
            <motion.button
              onClick={handleAddToCart}
              disabled={!canAddToCart() || showSuccess}
              className={cn(
                'flex-1 py-3.5 px-6 rounded-xl font-bold text-white transition-all duration-300 flex items-center justify-center gap-2'
              )}
              style={{
                backgroundColor: showSuccess ? '#10b981' : (canAddToCart() ? primaryColor : '#9ca3af'),
                boxShadow: canAddToCart() && !showSuccess ? `0 4px 15px ${primaryColor}40` : 'none',
              }}
              whileTap={{ scale: 0.98 }}
            >
              <AnimatePresence mode="wait">
                {showSuccess ? (
                  <motion.div
                    key="success"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    className="flex items-center gap-2"
                  >
                    <Check className="w-5 h-5" />
                    <span>{t('qrMenu.added', 'Added!')}</span>
                  </motion.div>
                ) : (
                  <motion.div
                    key="add"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    className="flex items-center gap-2"
                  >
                    <ShoppingCart className="w-5 h-5" />
                    <span>{t('qrMenu.addToCart', 'Add')}</span>
                    <span className="opacity-80">•</span>
                    <span>{formatCurrency(calculateTotal(), currency)}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.button>
          </div>

          {!canAddToCart() && (
            <motion.p
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-xs text-red-500 text-center mt-2"
            >
              {t('qrMenu.requiredModifiers', 'Please select required options')}
            </motion.p>
          )}
        </div>
      )}

      {/* View Only Mode Message */}
      {!enableCustomerOrdering && (
        <div className="p-4 bg-amber-50 border-t border-amber-100">
          <p className="text-sm text-amber-700 text-center">
            {t('qrMenu.viewOnlyMode', 'Menu viewing only - please order with staff assistance')}
          </p>
        </div>
      )}
    </BottomSheet>
  );
};

export default ProductDetailModalWithCart;
