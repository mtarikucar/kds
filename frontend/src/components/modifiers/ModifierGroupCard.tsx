import { useTranslation } from 'react-i18next';
import { Edit, Trash2, Plus } from 'lucide-react';
import { ModifierGroup, Modifier, SelectionType } from '../../types';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import { formatCurrency } from '../../lib/utils';

interface ModifierGroupCardProps {
  group: ModifierGroup;
  onEditGroup: (group: ModifierGroup) => void;
  onDeleteGroup: (group: ModifierGroup) => void;
  onAddModifier: (groupId: string) => void;
  onEditModifier: (modifier: Modifier) => void;
  onDeleteModifier: (modifier: Modifier) => void;
}

const ModifierGroupCard = ({
  group,
  onEditGroup,
  onDeleteGroup,
  onAddModifier,
  onEditModifier,
  onDeleteModifier,
}: ModifierGroupCardProps) => {
  const { t } = useTranslation(['menu', 'common']);

  const getSelectionTypeLabel = () => {
    if (group.selectionType === SelectionType.SINGLE) {
      return t('menu.singleSelection');
    }
    let label = t('menu.multipleSelection');
    if (group.maxSelections) {
      label += ` (max ${group.maxSelections})`;
    }
    return label;
  };

  const productCount = group._count?.productMappings || 0;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-foreground">{group.displayName}</h3>
            <Badge variant={group.isRequired ? 'danger' : 'default'}>
              {group.isRequired ? t('menu.required') : t('menu.optional')}
            </Badge>
            <Badge variant={group.isActive ? 'success' : 'warning'}>
              {group.isActive ? t('common:app.active') : t('common:app.inactive')}
            </Badge>
          </div>
          <p className="text-sm text-gray-500">
            {getSelectionTypeLabel()}
            {group.minSelections > 0 && ` | min: ${group.minSelections}`}
          </p>
          {group.description && (
            <p className="text-sm text-gray-600 mt-1">{group.description}</p>
          )}
        </div>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEditGroup(group)}
            title={t('common:app.edit')}
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => onDeleteGroup(group)}
            title={t('common:app.delete')}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Modifiers */}
      <div className="mb-3">
        {group.modifiers && group.modifiers.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {group.modifiers
              .sort((a, b) => a.displayOrder - b.displayOrder)
              .map((modifier) => (
                <div
                  key={modifier.id}
                  className={`group relative inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm border transition-colors ${
                    modifier.isAvailable
                      ? 'bg-neutral-50 border-neutral-200 text-neutral-700'
                      : 'bg-gray-100 border-gray-300 text-gray-400 line-through'
                  }`}
                >
                  <span>{modifier.displayName}</span>
                  <span className={`font-medium ${modifier.priceAdjustment > 0 ? 'text-green-600' : 'text-gray-500'}`}>
                    {modifier.priceAdjustment > 0 ? `+${formatCurrency(modifier.priceAdjustment)}` : formatCurrency(0)}
                  </span>

                  {/* Hover actions */}
                  <div className="absolute -top-1 -right-1 hidden group-hover:flex gap-0.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditModifier(modifier);
                      }}
                      className="p-1 bg-primary-500 text-white rounded-full hover:bg-primary-600 shadow-sm transition-colors duration-200"
                      title={t('common:app.edit')}
                    >
                      <Edit className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteModifier(modifier);
                      }}
                      className="p-1 bg-red-500 text-white rounded-full hover:bg-red-600 shadow-sm"
                      title={t('common:app.delete')}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400 italic">{t('menu.noModifiersInGroup')}</p>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-gray-100">
        <span className="text-sm text-gray-500">
          {t('menu.usedInProducts', { count: productCount })}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onAddModifier(group.id)}
        >
          <Plus className="h-4 w-4 mr-1" />
          {t('menu.addModifier')}
        </Button>
      </div>
    </div>
  );
};

export default ModifierGroupCard;
