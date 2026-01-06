import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { useModifierGroups, useProductModifiers } from '../../features/modifiers/modifiersApi';
import Spinner from '../ui/Spinner';
import Badge from '../ui/Badge';

interface ProductModifierSelectorProps {
  productId?: string;
  selectedGroupIds: string[];
  onSelectionChange: (groupIds: string[]) => void;
}

const ProductModifierSelector = ({
  productId,
  selectedGroupIds,
  onSelectionChange,
}: ProductModifierSelectorProps) => {
  const { t } = useTranslation(['menu']);
  const { data: allGroups, isLoading: groupsLoading } = useModifierGroups();
  const { data: productModifiers, isLoading: productModifiersLoading } = useProductModifiers(
    productId || ''
  );

  // Initialize selection from product's current modifiers when editing
  useEffect(() => {
    if (productId && productModifiers && productModifiers.length > 0) {
      const currentGroupIds = productModifiers.map((pm) => pm.id);
      onSelectionChange(currentGroupIds);
    }
  }, [productModifiers, productId]);

  const toggleGroup = (groupId: string) => {
    if (selectedGroupIds.includes(groupId)) {
      onSelectionChange(selectedGroupIds.filter((id) => id !== groupId));
    } else {
      onSelectionChange([...selectedGroupIds, groupId]);
    }
  };

  if (groupsLoading || (productId && productModifiersLoading)) {
    return (
      <div className="flex justify-center py-4">
        <Spinner size="sm" />
      </div>
    );
  }

  if (!allGroups || allGroups.length === 0) {
    return (
      <div className="text-center py-4 text-gray-500 text-sm">
        {t('menu.noModifierGroupsAvailable')}
      </div>
    );
  }

  // Only show active groups
  const activeGroups = allGroups.filter((g) => g.isActive);

  if (activeGroups.length === 0) {
    return (
      <div className="text-center py-4 text-gray-500 text-sm">
        {t('menu.noModifierGroupsAvailable')}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {activeGroups.map((group) => {
        const isSelected = selectedGroupIds.includes(group.id);
        return (
          <label
            key={group.id}
            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              isSelected
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div
              className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${
                isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
              }`}
            >
              {isSelected && <Check className="w-3 h-3 text-white" />}
            </div>
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => toggleGroup(group.id)}
              className="sr-only"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">{group.displayName}</span>
                <Badge variant={group.isRequired ? 'danger' : 'default'}>
                  {group.isRequired ? t('menu.required') : t('menu.optional')}
                </Badge>
              </div>
              {group.modifiers && group.modifiers.length > 0 && (
                <p className="text-sm text-gray-500 truncate">
                  {group.modifiers.map((m) => m.displayName).join(', ')}
                </p>
              )}
            </div>
          </label>
        );
      })}
    </div>
  );
};

export default ProductModifierSelector;
