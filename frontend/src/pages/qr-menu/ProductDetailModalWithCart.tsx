import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, UtensilsCrossed, Plus, Minus, ShoppingCart, Check } from 'lucide-react';
import { Product, ModifierGroup, Modifier, CartModifier, SelectionType } from '../../types';
import { formatCurrency, cn } from '../../lib/utils';
import { useCartStore } from '../../store/cartStore';

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
}) => {
  const { t } = useTranslation('common');
  const addItem = useCartStore(state => state.addItem);

  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [selectedModifiers, setSelectedModifiers] = useState<Map<string, CartModifier[]>>(new Map());
  const [showSuccess, setShowSuccess] = useState(false);

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

  const imageUrl = normalizeImageUrl(product.image || product.images?.[0]?.url);

  const handleModifierToggle = (group: ModifierGroup, modifier: Modifier) => {
    const newSelectedModifiers = new Map(selectedModifiers);
    const groupModifiers = newSelectedModifiers.get(group.id) || [];

    const existingIndex = groupModifiers.findIndex(m => m.id === modifier.id);

    if (group.selectionType === SelectionType.SINGLE) {
      // Single selection: replace any existing selection
      if (existingIndex !== -1) {
        // Deselect if clicking the same modifier
        newSelectedModifiers.set(group.id, []);
      } else {
        // Select new modifier
        newSelectedModifiers.set(group.id, [{
          id: modifier.id,
          name: modifier.name,
          displayName: modifier.displayName,
          priceAdjustment: modifier.priceAdjustment,
          quantity: 1,
        }]);
      }
    } else {
      // Multiple selection
      if (existingIndex !== -1) {
        // Remove modifier
        const updated = groupModifiers.filter(m => m.id !== modifier.id);
        newSelectedModifiers.set(group.id, updated);
      } else {
        // Check max selections
        if (group.maxSelections && groupModifiers.length >= group.maxSelections) {
          return; // Max selections reached
        }
        // Add modifier
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
    // Check if all required modifier groups have selections
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

    // Show success animation with smooth transition
    setShowSuccess(true);
    setTimeout(() => {
      setShowSuccess(false);
      // Close modal after animation completes
      setTimeout(() => {
        onClose();
      }, 300);
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 animate-in fade-in"
          onClick={onClose}
        ></div>

        {/* Modal */}
        <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto">
          {/* Gradient accent */}
          <div
            className="absolute top-0 left-0 right-0 h-1"
            style={{
              background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor})`,
            }}
          ></div>

          {/* Image */}
          {showImages && (
            <div className="relative w-full h-64 bg-gradient-to-br from-gray-100 to-gray-200 overflow-hidden">
              {imageUrl ? (
                <>
                  <img
                    src={imageUrl}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent"></div>
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 via-gray-150 to-gray-200">
                  <UtensilsCrossed className="h-20 w-20 text-gray-300" />
                </div>
              )}

              {/* Close Button */}
              <button
                onClick={onClose}
                className="absolute top-4 right-4 z-10 p-2.5 rounded-full bg-white/95 hover:bg-white shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-110 active:scale-95"
                style={{ color: primaryColor }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          )}

          {/* Content */}
          <div className="p-6">
            {/* Product Name */}
            <h2
              className="text-2xl font-bold mb-2 leading-tight"
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
                  {formatCurrency(product.price, 'USD')}
                </p>
              </div>
            )}

            {/* Description */}
            {showDescription && product.description && (
              <div className="mb-6">
                <p className="text-gray-700 leading-relaxed text-sm">
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
                      <h3 className="text-lg font-semibold text-gray-900">
                        {group.displayName}
                        {group.isRequired && (
                          <span className="ml-2 text-xs text-red-500">*</span>
                        )}
                      </h3>
                      {group.description && (
                        <p className="text-sm text-gray-500 mt-1">{group.description}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        {group.selectionType === SelectionType.SINGLE
                          ? t('qrMenu.selectOne', 'Select one')
                          : group.maxSelections
                          ? t('qrMenu.selectUpTo', { max: group.maxSelections }, `Select up to ${group.maxSelections}`)
                          : t('qrMenu.selectMultiple', 'Select multiple')}
                      </p>
                    </div>

                    <div className="space-y-2">
                      {group.modifiers.map(modifier => {
                        const selected = isModifierSelected(group.id, modifier.id);
                        return (
                          <button
                            key={modifier.id}
                            onClick={() => handleModifierToggle(group, modifier)}
                            className={cn(
                              'w-full flex items-center justify-between p-3 rounded-lg border-2 transition-all',
                              selected
                                ? 'border-green-500 bg-green-50'
                                : 'border-gray-200 hover:border-gray-300 bg-white'
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className={cn(
                                  'w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all',
                                  selected
                                    ? 'border-green-500 bg-green-500'
                                    : 'border-gray-300'
                                )}
                              >
                                {selected && <Check className="w-3 h-3 text-white" />}
                              </div>
                              <div className="text-left">
                                <p className="font-medium text-gray-900">
                                  {modifier.displayName}
                                </p>
                                {modifier.description && (
                                  <p className="text-xs text-gray-500">{modifier.description}</p>
                                )}
                              </div>
                            </div>
                            {modifier.priceAdjustment > 0 && (
                              <span className="text-sm font-semibold text-green-600">
                                +{formatCurrency(modifier.priceAdjustment, 'USD')}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Notes */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('qrMenu.specialInstructions', 'Special Instructions')}
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('qrMenu.notesPlaceholder', 'E.g., No onions, extra sauce...')}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-opacity-50 resize-none"
                style={{ focusRing: primaryColor }}
                rows={3}
              />
            </div>

            {/* Quantity and Add to Cart */}
            <div className="flex items-center justify-between gap-4">
              {/* Quantity */}
              <div className="flex items-center gap-2 border-2 border-gray-200 rounded-lg p-1">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="p-2 rounded hover:bg-gray-100 transition-colors"
                  disabled={quantity <= 1}
                >
                  <Minus className="w-5 h-5 text-gray-600" />
                </button>
                <span className="w-12 text-center font-semibold text-lg">{quantity}</span>
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="p-2 rounded hover:bg-gray-100 transition-colors"
                >
                  <Plus className="w-5 h-5 text-gray-600" />
                </button>
              </div>

              {/* Add to Cart Button - Icon Only */}
              <button
                onClick={handleAddToCart}
                disabled={!enableCustomerOrdering || !canAddToCart() || showSuccess}
                className={cn(
                  'py-4 px-4 rounded-xl font-semibold text-white transition-all duration-300 flex items-center justify-center transform',
                  enableCustomerOrdering && canAddToCart() && !showSuccess
                    ? 'hover:shadow-lg active:scale-95 hover:scale-110'
                    : 'opacity-50 cursor-not-allowed',
                  showSuccess ? 'scale-95' : ''
                )}
                style={{
                  backgroundColor: showSuccess ? '#10b981' : (enableCustomerOrdering && canAddToCart() ? primaryColor : '#9ca3af'),
                }}
                title={showSuccess ? t('qrMenu.added', 'Added!') : t('qrMenu.addToCart', 'Add to Cart')}
              >
                {showSuccess ? (
                  <Check className="w-6 h-6 animate-pulse" />
                ) : (
                  <ShoppingCart className="w-6 h-6" />
                )}
              </button>
            </div>

            {!enableCustomerOrdering ? (
              <p className="text-sm text-yellow-600 mt-2 text-center">
                {t('qrMenu.viewOnlyMode', 'Menu viewing only - please order with staff assistance')}
              </p>
            ) : !canAddToCart() && (
              <p className="text-sm text-red-500 mt-2 text-center">
                {t('qrMenu.requiredModifiers', 'Please select required options')}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetailModalWithCart;
