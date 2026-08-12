import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  useModifierGroups,
  useProductModifiers,
  useCreateModifierGroup,
  useUpdateModifierGroup,
  useDeleteModifierGroup,
  useCreateModifier,
  useUpdateModifier,
  useDeleteModifier,
} from '../../features/modifiers/modifiersApi';
import Spinner from '../ui/Spinner';
import Badge from '../ui/Badge';
import ModifierGroupModal from './ModifierGroupModal';
import ModifierItemModal from './ModifierItemModal';
import type {
  CreateModifierDto,
  CreateModifierGroupDto,
  Modifier,
  ModifierGroup,
} from '../../types';

interface ProductModifierSelectorProps {
  productId?: string;
  selectedGroupIds: string[];
  onSelectionChange: (groupIds: string[]) => void;
}

/**
 * Option groups for a product — chosen AND managed in the same place.
 *
 * Creating or editing a group used to live on its own "Modifiye" tab, so
 * building a product meant leaving it, defining the group, coming back and
 * ticking it. Groups are reusable, which is why they had their own table and
 * then their own tab; but reusable is not the same as separate, and the moment
 * you need one is while you are looking at the product that needs it.
 */
const ProductModifierSelector = ({
  productId,
  selectedGroupIds,
  onSelectionChange,
}: ProductModifierSelectorProps) => {
  const { t } = useTranslation(['menu', 'common']);
  const { data: allGroups, isLoading: groupsLoading } = useModifierGroups();
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ModifierGroup | null>(null);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [itemGroupId, setItemGroupId] = useState('');
  const [editingItem, setEditingItem] = useState<Modifier | null>(null);

  const { mutate: createGroup, isPending: creatingGroup } =
    useCreateModifierGroup();
  const { mutate: updateGroup, isPending: updatingGroup } =
    useUpdateModifierGroup();
  const { mutate: deleteGroup } = useDeleteModifierGroup();
  const { mutate: createItem, isPending: creatingItem } = useCreateModifier();
  const { mutate: updateItem, isPending: updatingItem } = useUpdateModifier();
  const { mutate: deleteItem } = useDeleteModifier();

  const submitGroup = (data: CreateModifierGroupDto) => {
    const done = {
      onSuccess: (created?: ModifierGroup) => {
        setGroupModalOpen(false);
        // A group created from HERE is created because this product needs it,
        // so tick it rather than making the operator find it in the list.
        if (!editingGroup && created?.id) {
          onSelectionChange([...selectedGroupIds, created.id]);
        }
        setEditingGroup(null);
      },
    };
    if (editingGroup) {
      updateGroup({ id: editingGroup.id, data }, done);
    } else {
      createGroup(data, done as never);
    }
  };

  const submitItem = (data: CreateModifierDto) => {
    const done = {
      onSuccess: () => {
        setItemModalOpen(false);
        setEditingItem(null);
      },
    };
    if (editingItem) {
      const { groupId: _groupId, ...rest } = data;
      updateItem({ id: editingItem.id, data: rest }, done);
    } else {
      createItem(data, done);
    }
  };
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

  const activeGroups = (allGroups ?? []).filter((g) => g.isActive);

  return (
    <div className="space-y-2">
      {activeGroups.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">
          {t('menu.noModifierGroupsAvailable')}
        </p>
      )}
      {activeGroups.map((group) => {
        const isSelected = selectedGroupIds.includes(group.id);
        return (
          <label
            key={group.id}
            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              isSelected
                ? 'border-blue-500 bg-blue-50'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div
              className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${
                isSelected ? 'bg-blue-500 border-blue-500' : 'border-slate-300'
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
                <span className="font-medium text-slate-900">{group.displayName}</span>
                <Badge variant={group.isRequired ? 'danger' : 'default'}>
                  {group.isRequired ? t('menu.required') : t('menu.optional')}
                </Badge>
              </div>
              {group.modifiers && group.modifiers.length > 0 ? (
                // Options are chips rather than a comma list so each one can be
                // edited or removed here. The retired Modifiye tab was the only
                // place that could, and losing it would have made a mistyped
                // option permanent.
                <div className="mt-1 flex flex-wrap gap-1">
                  {group.modifiers.map((modifier) => (
                    <span
                      key={modifier.id}
                      className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200"
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          setItemGroupId(group.id);
                          setEditingItem(modifier);
                          setItemModalOpen(true);
                        }}
                        className="hover:text-primary-600"
                      >
                        {modifier.displayName}
                        {Number(modifier.priceAdjustment) !== 0 && (
                          <span className="ml-1 tabular-nums text-slate-400">
                            {Number(modifier.priceAdjustment) > 0 ? '+' : '−'}₺
                            {Math.abs(
                              Number(modifier.priceAdjustment),
                            ).toLocaleString('tr-TR')}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          if (confirm(t('menu.confirmDeleteModifier'))) {
                            deleteItem(modifier.id);
                          }
                        }}
                        className="text-slate-300 hover:text-red-600"
                        aria-label={t('common:app.delete', {
                          defaultValue: 'Sil',
                        })}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                // A group with no options renders as an empty picker at the
                // POS, so say it here rather than at sale time.
                <p className="text-sm text-amber-600">
                  {t('menu.groupHasNoOptions', {
                    defaultValue: 'Henüz seçenek yok — ekleyin',
                  })}
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setItemGroupId(group.id);
                  setEditingItem(null);
                  setItemModalOpen(true);
                }}
                title={t('menu.addModifier', { defaultValue: 'Seçenek ekle' })}
                className="rounded p-1 text-slate-400 hover:bg-white hover:text-primary-600"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setEditingGroup(group);
                  setGroupModalOpen(true);
                }}
                title={t('menu.editModifierGroup', {
                  defaultValue: 'Grubu düzenle',
                })}
                className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  if (!confirm(t('menu.confirmDeleteModifierGroup'))) return;
                  deleteGroup(group.id, {
                    onSuccess: () =>
                      onSelectionChange(
                        selectedGroupIds.filter((id) => id !== group.id),
                      ),
                  });
                }}
                title={t('common:app.delete', { defaultValue: 'Sil' })}
                className="rounded p-1 text-slate-400 hover:bg-white hover:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </label>
        );
      })}

      <button
        type="button"
        onClick={() => {
          setEditingGroup(null);
          setGroupModalOpen(true);
        }}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-sm font-medium text-slate-600 hover:border-primary-400 hover:text-primary-600"
      >
        <Plus className="h-4 w-4" />
        {t('menu.addModifierGroup')}
      </button>

      <ModifierGroupModal
        isOpen={groupModalOpen}
        onClose={() => {
          setGroupModalOpen(false);
          setEditingGroup(null);
        }}
        onSubmit={submitGroup}
        editingGroup={editingGroup}
        isLoading={creatingGroup || updatingGroup}
      />
      <ModifierItemModal
        isOpen={itemModalOpen}
        onClose={() => {
          setItemModalOpen(false);
          setEditingItem(null);
        }}
        onSubmit={submitItem}
        editingModifier={editingItem}
        groupId={itemGroupId}
        isLoading={creatingItem || updatingItem}
      />
    </div>
  );
};

export default ProductModifierSelector;
