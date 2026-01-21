import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence, useDragControls, PanInfo } from 'framer-motion';
import { X, UtensilsCrossed, Plus, Minus, ShoppingCart, Check } from 'lucide-react';
import { Product, ModifierGroup, Modifier, CartModifier, SelectionType } from '../../types';
import { formatCurrency, cn } from '../../lib/utils';
import { useCartStore } from '../../store/cartStore';
import ProductImageGallery from '../../components/qr-menu/ProductImageGallery';

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
  const dragControls = useDragControls();
  const contentRef = useRef<HTMLDivElement>(null);

  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [selectedModifiers, setSelectedModifiers] = useState<Map<string, CartModifier[]>>(new Map());
  const [showSuccess, setShowSuccess] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Check if mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen && product) {
      // Reset state when modal opens
      setQuantity(1);
      setNotes('');
      setSelectedModifiers(new Map());
      setShowSuccess(false);
    }
  }, [isOpen, product]);

  if (!isOpen || !product) return null;

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

  // Prepare images for gallery
  const productImages = product.images?.length
    ? product.images.map(img => ({ url: img.url, alt: product.name }))
    : product.image
      ? [{ url: product.image, alt: product.name }]
      : [];

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

  const handleDragEnd = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.y > 100) {
      onClose();
    }
  };

  // Desktop modal variants
  const desktopVariants = {
    hidden: { scale: 0.95, opacity: 0 },
    visible: { scale: 1, opacity: 1 },
    exit: { scale: 0.95, opacity: 0 },
  };

  // Mobile drawer variants
  const mobileVariants = {
    hidden: { y: '100%' },
    visible: { y: 0 },
    exit: { y: '100%' },
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal Container */}
          <div className={cn(
            'fixed inset-0 flex',
            isMobile ? 'items-end' : 'items-center justify-center p-4'
          )}>
            <motion.div
              ref={contentRef}
              variants={isMobile ? mobileVariants : desktopVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={{
                type: isMobile ? 'spring' : 'tween',
                damping: 25,
                stiffness: 300,
                duration: isMobile ? undefined : 0.2,
              }}
              drag={isMobile ? 'y' : false}
              dragControls={dragControls}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.5 }}
              onDragEnd={handleDragEnd}
              className={cn(
                'relative bg-white shadow-2xl overflow-hidden',
                isMobile
                  ? 'w-full rounded-t-3xl max-h-[95vh]'
                  : 'w-full max-w-2xl rounded-3xl max-h-[90vh]'
              )}
              style={{
                paddingBottom: isMobile ? 'env(safe-area-inset-bottom, 0px)' : undefined,
              }}
            >
              {/* Gradient accent */}
              <div
                className="absolute top-0 left-0 right-0 h-1 z-10"
                style={{
                  background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor})`,
                }}
              />

              {/* Drag Handle (Mobile) */}
              {isMobile && (
                <div
                  className="sticky top-0 z-20 bg-white pt-3 pb-2 cursor-grab active:cursor-grabbing"
                  onPointerDown={(e) => dragControls.start(e)}
                >
                  <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto" />
                </div>
              )}

              {/* Scrollable Content */}
              <div className="overflow-y-auto max-h-[calc(95vh-80px)] md:max-h-[calc(90vh-20px)]">
                {/* Image */}
                {showImages && (
                  <div className={cn(
                    'relative bg-gradient-to-br from-slate-100 to-slate-200 overflow-hidden',
                    isMobile ? 'h-56' : 'h-64'
                  )}>
                    {productImages.length > 0 ? (
                      <ProductImageGallery
                        images={productImages}
                        className="h-full"
                        showThumbnails={!isMobile && productImages.length > 1}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 via-slate-150 to-slate-200">
                        <UtensilsCrossed className="h-20 w-20 text-slate-300" />
                      </div>
                    )}

                    {/* Close Button (Desktop) */}
                    {!isMobile && (
                      <button
                        onClick={onClose}
                        className="absolute top-4 right-4 z-10 p-2.5 rounded-full bg-white/95 hover:bg-white shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-110 active:scale-95"
                        style={{ color: primaryColor }}
                      >
                        <X className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                )}

                {/* Content */}
                <div className="p-6">
                  {/* Close Button (Mobile - when no image) */}
                  {isMobile && !showImages && (
                    <button
                      onClick={onClose}
                      className="absolute top-4 right-4 z-10 p-2 rounded-full bg-slate-100 hover:bg-slate-200 transition-colors"
                    >
                      <X className="h-5 w-5 text-slate-600" />
                    </button>
                  )}

                  {/* Product Name */}
                  <h2
                    className="text-2xl font-bold mb-2 leading-tight pr-10"
                    style={{ color: secondaryColor }}
                  >
                    {product.name}
                  </h2>

                  {/* Price */}
                  {showPrices && (
                    <div className="mb-4">
                      <p
                        className="text-3xl font-black"
                        style={{ color: primaryColor }}
                      >
                        {formatCurrency(product.price, currency)}
                      </p>
                    </div>
                  )}

                  {/* Description */}
                  {showDescription && product.description && (
                    <div className="mb-6">
                      <p className="text-slate-700 leading-relaxed text-sm">
                        {product.description}
                      </p>
                    </div>
                  )}

                  {/* Modifiers */}
                  {product.modifierGroups && product.modifierGroups.length > 0 && (
                    <div className="mb-6 space-y-6">
                      {product.modifierGroups.map(group => (
                        <div key={group.id} className="border-t pt-4">
                          <div className="mb-3">
                            <h3 className="text-lg font-semibold text-slate-900">
                              {group.displayName}
                              {group.isRequired && (
                                <span className="ml-2 text-xs text-red-500">*</span>
                              )}
                            </h3>
                            {group.description && (
                              <p className="text-sm text-slate-500 mt-1">{group.description}</p>
                            )}
                            <p className="text-xs text-slate-400 mt-1">
                              {group.selectionType === SelectionType.SINGLE
                                ? t('qrMenu.selectOne', 'Select one')
                                : group.maxSelections
                                  ? t('qrMenu.selectUpTo', `Select up to ${group.maxSelections}`, { max: group.maxSelections })
                                  : t('qrMenu.selectMultiple', 'Select multiple')}
                            </p>
                          </div>

                          <div className="space-y-2">
                            {group.modifiers.map(modifier => {
                              const selected = isModifierSelected(group.id, modifier.id);
                              return (
                                <motion.button
                                  key={modifier.id}
                                  onClick={() => handleModifierToggle(group, modifier)}
                                  className={cn(
                                    'w-full flex items-center justify-between p-3 rounded-xl border-2 transition-all',
                                    selected
                                      ? 'border-green-500 bg-green-50'
                                      : 'border-slate-200/60 hover:border-slate-300 bg-white'
                                  )}
                                  whileTap={{ scale: 0.98 }}
                                >
                                  <div className="flex items-center gap-3">
                                    <div
                                      className={cn(
                                        'w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all',
                                        selected
                                          ? 'border-green-500 bg-green-500'
                                          : 'border-slate-300'
                                      )}
                                    >
                                      {selected && <Check className="w-3 h-3 text-white" />}
                                    </div>
                                    <div className="text-left">
                                      <p className="font-medium text-slate-900">
                                        {modifier.displayName}
                                      </p>
                                      {modifier.description && (
                                        <p className="text-xs text-slate-500">{modifier.description}</p>
                                      )}
                                    </div>
                                  </div>
                                  {modifier.priceAdjustment > 0 && (
                                    <span className="text-sm font-semibold text-green-600">
                                      +{formatCurrency(modifier.priceAdjustment, currency)}
                                    </span>
                                  )}
                                </motion.button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Notes */}
                  {enableCustomerOrdering && (
                    <div className="mb-6">
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        {t('qrMenu.specialInstructions', 'Special Instructions')}
                      </label>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder={t('qrMenu.notesPlaceholder', 'E.g., No onions, extra sauce...')}
                        className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-opacity-50 focus:border-transparent resize-none transition-all"
                        style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                        rows={3}
                      />
                    </div>
                  )}

                  {/* Quantity and Add to Cart */}
                  {enableCustomerOrdering ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-4">
                        {/* Quantity */}
                        <div className="flex items-center gap-2 border-2 border-slate-200 rounded-xl p-1">
                          <motion.button
                            onClick={() => setQuantity(Math.max(1, quantity - 1))}
                            className="p-2.5 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50"
                            disabled={quantity <= 1}
                            whileTap={{ scale: 0.9 }}
                          >
                            <Minus className="w-5 h-5 text-slate-600" />
                          </motion.button>
                          <span className="w-12 text-center font-semibold text-lg">{quantity}</span>
                          <motion.button
                            onClick={() => setQuantity(quantity + 1)}
                            className="p-2.5 rounded-lg hover:bg-slate-100 transition-colors"
                            whileTap={{ scale: 0.9 }}
                          >
                            <Plus className="w-5 h-5 text-slate-600" />
                          </motion.button>
                        </div>

                        {/* Add to Cart Button */}
                        <motion.button
                          onClick={handleAddToCart}
                          disabled={!canAddToCart() || showSuccess}
                          className={cn(
                            'flex-1 py-4 px-6 rounded-xl font-semibold text-white transition-all duration-300 flex items-center justify-center gap-2',
                            canAddToCart() && !showSuccess
                              ? 'shadow-lg hover:shadow-xl'
                              : 'opacity-50 cursor-not-allowed'
                          )}
                          style={{
                            backgroundColor: showSuccess ? '#10b981' : (canAddToCart() ? primaryColor : '#9ca3af'),
                          }}
                          whileTap={{ scale: 0.98 }}
                          whileHover={canAddToCart() && !showSuccess ? { scale: 1.02 } : {}}
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
                                <span>{formatCurrency(calculateTotal(), currency)}</span>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.button>
                      </div>

                      {!canAddToCart() && (
                        <p className="text-sm text-red-500 text-center">
                          {t('qrMenu.requiredModifiers', 'Please select required options')}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="py-4 px-6 bg-yellow-50 rounded-xl border border-yellow-200">
                      <p className="text-sm text-yellow-700 text-center">
                        {t('qrMenu.viewOnlyMode', 'Menu viewing only - please order with staff assistance')}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default ProductDetailModalWithCart;
