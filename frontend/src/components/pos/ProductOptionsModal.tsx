import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Minus, Check } from 'lucide-react';
import {
  Product,
  ModifierGroup,
  Modifier,
  SelectionType,
  ComboGroup,
  ComboItem,
  ComboSelectionInput,
} from '../../types';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

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
  onAddToCart: (
    product: Product,
    quantity: number,
    modifiers: SelectedModifier[],
    comboSelections?: ComboSelectionInput[],
  ) => void;
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
  const [comboSelections, setComboSelections] = useState<Map<string, string[]>>(
    new Map(),
  );
  const isCombo = product.productType === 'COMBO';

  // Reset state when modal opens with a new product; preselect combo defaults.
  useEffect(() => {
    if (isOpen) {
      setQuantity(1);
      setSelectedModifiers(new Map());
      const initialCombo = new Map<string, string[]>();
      (product.comboGroups ?? []).forEach((g) => {
        initialCombo.set(
          g.id,
          g.items
            .filter((i) => i.isDefault)
            .map((i) => i.componentProductId)
            .slice(0, g.maxSelect),
        );
      });
      setComboSelections(initialCombo);
    }
  }, [isOpen, product.id, product.comboGroups]);

  const handleComboToggle = (group: ComboGroup, item: ComboItem) => {
    setComboSelections((prev) => {
      const next = new Map(prev);
      const cur = next.get(group.id) || [];
      const selected = cur.includes(item.componentProductId);
      if (group.maxSelect === 1) {
        next.set(group.id, [item.componentProductId]);
      } else if (selected) {
        next.set(group.id, cur.filter((x) => x !== item.componentProductId));
      } else if (cur.length < group.maxSelect) {
        next.set(group.id, [...cur, item.componentProductId]);
      }
      return next;
    });
  };

  const comboUnitPrice = (): number => {
    let total = Number(product.price);
    (product.comboGroups ?? []).forEach((g) => {
      (comboSelections.get(g.id) || []).forEach((cid) => {
        const it = g.items.find((i) => i.componentProductId === cid);
        if (it) total += Number(it.priceDelta) * (it.quantity ?? 1);
      });
    });
    return total;
  };

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
    if (isCombo) {
      for (const g of product.comboGroups ?? []) {
        const n = (comboSelections.get(g.id) || []).length;
        if (n < g.minSelect || n > g.maxSelect) return false;
      }
    }
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
    let total = isCombo ? comboUnitPrice() : Number(product.price);
    selectedModifiers.forEach((modifiers) => {
      modifiers.forEach((mod) => {
        total += mod.priceAdjustment * mod.quantity;
      });
    });
    return total * quantity;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.price, selectedModifiers, comboSelections, quantity]);

  const handleAddToCart = () => {
    if (!canAddToCart()) return;

    const allModifiers: SelectedModifier[] = [];
    selectedModifiers.forEach((modifiers) => {
      allModifiers.push(...modifiers);
    });

    let comboSel: ComboSelectionInput[] | undefined;
    let productForCart = product;
    if (isCombo) {
      comboSel = [];
      (product.comboGroups ?? []).forEach((g) => {
        (comboSelections.get(g.id) || []).forEach((cid) =>
          comboSel!.push({ groupId: g.id, componentProductId: cid }),
        );
      });
      // Fold the chosen slot deltas into the line price so the cart total math
      // (which reads item.price) is correct without a combo special-case.
      productForCart = { ...product, price: comboUnitPrice() };
    }

    onAddToCart(
      productForCart,
      quantity,
      allModifiers,
      comboSel && comboSel.length ? comboSel : undefined,
    );
    onClose();
  };

  const hasModifierGroups = product.modifierGroups && product.modifierGroups.length > 0;
  const hasComboGroups = isCombo && (product.comboGroups?.length ?? 0) > 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={product.name} size="lg">
      <div className="space-y-4">
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
              <p className="text-slate-600 text-sm line-clamp-2">{product.description}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {isCombo && (
                  <span className="text-xs font-medium text-slate-400">
                    {t('startingFrom', 'başlangıç')}
                  </span>
                )}
                <p className="text-xl font-bold text-blue-600">
                  {formatPrice(product.price)}
                </p>
                {product.campaignActive && product.listPrice != null && (
                  <>
                    <span className="text-sm text-slate-400 line-through">
                      {formatPrice(product.listPrice)}
                    </span>
                    <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
                      {product.campaignLabel || t('campaign', 'Kampanya')}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Combo slots */}
          {hasComboGroups &&
            product.comboGroups!.map((group) => {
              const n = (comboSelections.get(group.id) || []).length;
              return (
                <div key={group.id} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-800">
                      {group.displayName || group.name}
                    </h3>
                    {(n < group.minSelect || n > group.maxSelect) && (
                      <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">
                        {t('required', 'Zorunlu')}
                      </span>
                    )}
                    {group.maxSelect > 1 && (
                      <span className="text-xs text-slate-500">
                        (en çok {group.maxSelect})
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {group.items.map((item) => {
                      const isSelected = (
                        comboSelections.get(group.id) || []
                      ).includes(item.componentProductId);
                      return (
                        <button
                          key={item.id}
                          onClick={() => handleComboToggle(group, item)}
                          className={`w-full flex items-center justify-between p-3 rounded-lg border-2 transition-all ${
                            isSelected
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                                isSelected
                                  ? 'border-blue-500 bg-blue-500'
                                  : 'border-slate-300'
                              }`}
                            >
                              {isSelected && (
                                <Check className="w-3 h-3 text-white" />
                              )}
                            </div>
                            <span
                              className={`font-medium ${isSelected ? 'text-blue-700' : 'text-slate-700'}`}
                            >
                              {item.quantity && item.quantity > 1
                                ? `${item.quantity}× `
                                : ''}
                              {item.name}
                            </span>
                          </div>
                          {Number(item.priceDelta) > 0 && (
                            <span
                              className={`text-sm font-semibold ${isSelected ? 'text-blue-600' : 'text-slate-500'}`}
                            >
                              +{formatPrice(Number(item.priceDelta))}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

          {/* Modifier Groups */}
          {hasModifierGroups && product.modifierGroups!.map((group) => (
            <div key={group.id} className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-slate-800">{group.displayName}</h3>
                {(group.isRequired || group.minSelections > 0) && (
                  <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">
                    {t('required')}
                  </span>
                )}
                {group.selectionType === SelectionType.MULTIPLE && group.maxSelections && (
                  <span className="text-xs text-slate-500">
                    ({t('maxSelections', { count: group.maxSelections })})
                  </span>
                )}
              </div>
              {group.description && (
                <p className="text-sm text-slate-500">{group.description}</p>
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
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                            isSelected
                              ? 'border-blue-500 bg-blue-500'
                              : 'border-slate-300'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <span className={`font-medium ${isSelected ? 'text-blue-700' : 'text-slate-700'}`}>
                          {modifier.name}
                        </span>
                      </div>
                      {Number(modifier.priceAdjustment) > 0 && (
                        <span className={`text-sm font-semibold ${isSelected ? 'text-blue-600' : 'text-slate-500'}`}>
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
              <span className="font-semibold text-slate-800">{t('quantity')}</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors disabled:opacity-50"
                  disabled={quantity <= 1}
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="text-xl font-bold w-8 text-center">{quantity}</span>
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

        {/* Sticky add-to-cart footer */}
        <div className="sticky bottom-0 -mx-4 sm:-mx-6 -mb-4 sm:-mb-5 mt-2 px-4 sm:px-6 py-3 border-t border-slate-100 bg-slate-50 space-y-3">
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
    </Modal>
  );
};

export default ProductOptionsModal;
