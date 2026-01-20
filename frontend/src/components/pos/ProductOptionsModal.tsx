import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, Minus, Check } from 'lucide-react';
import { Product, ModifierGroup, Modifier, SelectionType } from '../../types';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import Button from '../ui/Button';

export interface SelectedModifier {
  modifierId: string;
  name: string;
  priceAdjustment: number;
  quantity: number;
}

interface ProductOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product;
  onAddToCart: (product: Product, quantity: number, modifiers: SelectedModifier[]) => void;
}

const ProductOptionsModal = ({
  isOpen,
  onClose,
  product,
  onAddToCart,
}: ProductOptionsModalProps) => {
  const { t } = useTranslation('pos');
  const formatPrice = useFormatCurrency();

  const [quantity, setQuantity] = useState(1);
  const [selectedModifiers, setSelectedModifiers] = useState<Map<string, SelectedModifier[]>>(new Map());

  // Reset state when modal opens with a new product
  useEffect(() => {
    if (isOpen) {
      setQuantity(1);
      setSelectedModifiers(new Map());
    }
  }, [isOpen, product.id]);

  const handleModifierToggle = (group: ModifierGroup, modifier: Modifier) => {
    setSelectedModifiers((prev) => {
      const newMap = new Map(prev);
      const groupModifiers = newMap.get(group.id) || [];

      if (group.selectionType === SelectionType.SINGLE) {
        // Single selection: replace existing selection
        const existingIndex = groupModifiers.findIndex((m) => m.modifierId === modifier.id);
        if (existingIndex >= 0) {
          // Deselect if already selected
          newMap.set(group.id, []);
        } else {
          // Select this modifier
          newMap.set(group.id, [{
            modifierId: modifier.id,
            name: modifier.name,
            priceAdjustment: Number(modifier.priceAdjustment),
            quantity: 1,
          }]);
        }
      } else {
        // Multiple selection
        const existingIndex = groupModifiers.findIndex((m) => m.modifierId === modifier.id);
        if (existingIndex >= 0) {
          // Remove if exists
          newMap.set(
            group.id,
            groupModifiers.filter((m) => m.modifierId !== modifier.id)
          );
        } else {
          // Add if not at max
          if (!group.maxSelections || groupModifiers.length < group.maxSelections) {
            newMap.set(group.id, [
              ...groupModifiers,
              {
                modifierId: modifier.id,
                name: modifier.name,
                priceAdjustment: Number(modifier.priceAdjustment),
                quantity: 1,
              },
            ]);
          }
        }
      }

      return newMap;
    });
  };

  const canAddToCart = (): boolean => {
    if (!product.modifierGroups) return true;

    for (const group of product.modifierGroups) {
      if (group.isRequired || group.minSelections > 0) {
        const groupModifiers = selectedModifiers.get(group.id) || [];
        const minRequired = group.isRequired ? Math.max(1, group.minSelections) : group.minSelections;
        if (groupModifiers.length < minRequired) {
          return false;
        }
      }
    }
    return true;
  };

  const calculateTotal = useMemo(() => {
    let total = Number(product.price);
    selectedModifiers.forEach((modifiers) => {
      modifiers.forEach((mod) => {
        total += mod.priceAdjustment * mod.quantity;
      });
    });
    return total * quantity;
  }, [product.price, selectedModifiers, quantity]);

  const handleAddToCart = () => {
    if (!canAddToCart()) return;

    const allModifiers: SelectedModifier[] = [];
    selectedModifiers.forEach((modifiers) => {
      allModifiers.push(...modifiers);
    });

    onAddToCart(product, quantity, allModifiers);
    onClose();
  };

  if (!isOpen) return null;

  const hasModifierGroups = product.modifierGroups && product.modifierGroups.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-blue-600 to-blue-700">
          <h2 className="text-lg font-bold text-white truncate pr-4">{product.name}</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-white" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Product Info */}
          <div className="flex items-center gap-4 pb-4 border-b">
            {product.images && product.images.length > 0 && (
              <img
                src={product.images[0].url.startsWith('http')
                  ? product.images[0].url
                  : `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}${product.images[0].url}`}
                alt={product.name}
                className="w-20 h-20 rounded-lg object-cover"
              />
            )}
            <div className="flex-1">
              <p className="text-gray-600 text-sm line-clamp-2">{product.description}</p>
              <p className="text-xl font-bold text-primary-600 mt-1">{formatPrice(product.price)}</p>
            </div>
          </div>

          {/* Modifier Groups */}
          {hasModifierGroups && product.modifierGroups!.map((group) => (
            <div key={group.id} className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-800">{group.displayName}</h3>
                {(group.isRequired || group.minSelections > 0) && (
                  <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">
                    {t('required')}
                  </span>
                )}
                {group.selectionType === SelectionType.MULTIPLE && group.maxSelections && (
                  <span className="text-xs text-gray-500">
                    ({t('maxSelections', { count: group.maxSelections })})
                  </span>
                )}
              </div>
              {group.description && (
                <p className="text-sm text-gray-500">{group.description}</p>
              )}

              <div className="space-y-2">
                {group.modifiers.map((modifier) => {
                  const groupModifiers = selectedModifiers.get(group.id) || [];
                  const isSelected = groupModifiers.some((m) => m.modifierId === modifier.id);

                  return (
                    <button
                      key={modifier.id}
                      onClick={() => handleModifierToggle(group, modifier)}
                      className={`w-full flex items-center justify-between p-3 rounded-lg border-2 transition-all ${
                        isSelected
                          ? 'border-primary-500 bg-primary-50'
                          : 'border-neutral-200 hover:border-primary-300 hover:bg-neutral-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                            isSelected
                              ? 'border-primary-500 bg-primary-500'
                              : 'border-gray-300'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <span className={`font-medium ${isSelected ? 'text-primary-700' : 'text-neutral-700'}`}>
                          {modifier.name}
                        </span>
                      </div>
                      {Number(modifier.priceAdjustment) > 0 && (
                        <span className={`text-sm font-semibold ${isSelected ? 'text-primary-600' : 'text-neutral-500'}`}>
                          +{formatPrice(modifier.priceAdjustment)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Quantity Selector */}
          <div className="pt-4 border-t">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-gray-800">{t('quantity')}</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors disabled:opacity-50"
                  disabled={quantity <= 1}
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="text-xl font-bold w-8 text-center">{quantity}</span>
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50 space-y-3">
          {!canAddToCart() && (
            <p className="text-sm text-red-600 text-center">
              {t('selectRequiredOptions')}
            </p>
          )}
          <Button
            onClick={handleAddToCart}
            disabled={!canAddToCart()}
            className="w-full py-3 text-lg font-bold"
          >
            {t('addToOrder')} - {formatPrice(calculateTotal)}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ProductOptionsModal;
