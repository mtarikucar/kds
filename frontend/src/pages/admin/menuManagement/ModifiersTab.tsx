import { useTranslation } from 'react-i18next';
import { Plus, Settings2 } from 'lucide-react';
import { ModifierGroupCard } from '../../../components/modifiers';
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import Spinner from '../../../components/ui/Spinner';
import { ModifierGroup, Modifier } from '../../../types';

// Presentational extraction of the "modifiers" activeTab branch from
// MenuManagementPage. It owns no state: all data + handlers are passed in
// from the parent, which still holds the modifier hooks and modals. The
// rendered markup is identical to the inline version.
interface ModifiersTabProps {
  modifierGroups: ModifierGroup[] | undefined;
  modifierGroupsLoading: boolean;
  onAddGroup: () => void;
  onEditGroup: (group: ModifierGroup) => void;
  onDeleteGroup: (group: ModifierGroup) => void;
  onAddModifier: (groupId: string) => void;
  onEditModifier: (modifier: Modifier) => void;
  onDeleteModifier: (modifier: Modifier) => void;
}

const ModifiersTab = ({
  modifierGroups,
  modifierGroupsLoading,
  onAddGroup,
  onEditGroup,
  onDeleteGroup,
  onAddModifier,
  onEditModifier,
  onDeleteModifier,
}: ModifiersTabProps) => {
  const { t } = useTranslation(['menu', 'common']);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t('menu.modifierGroups')}</CardTitle>
        <Button onClick={() => onAddGroup()}>
          <Plus className="h-4 w-4 mr-2" />
          {t('menu.addModifierGroup')}
        </Button>
      </CardHeader>
      <CardContent>
        {modifierGroupsLoading ? (
          <Spinner />
        ) : !modifierGroups || modifierGroups.length === 0 ? (
          <div className="text-center py-12">
            <Settings2 className="mx-auto h-12 w-12 text-slate-400" />
            <h3 className="mt-4 text-lg font-medium text-slate-900">
              {t('menu.noModifierGroups')}
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              {t('menu.noModifierGroupsDesc')}
            </p>
            <Button
              className="mt-4"
              onClick={() => onAddGroup()}
            >
              <Plus className="h-4 w-4 mr-2" />
              {t('menu.addModifierGroup')}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {modifierGroups
              .sort((a, b) => a.displayOrder - b.displayOrder)
              .map((group) => (
                <ModifierGroupCard
                  key={group.id}
                  group={group}
                  onEditGroup={onEditGroup}
                  onDeleteGroup={onDeleteGroup}
                  onAddModifier={(groupId) => onAddModifier(groupId)}
                  onEditModifier={(modifier) => onEditModifier(modifier)}
                  onDeleteModifier={onDeleteModifier}
                />
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ModifiersTab;
