import { useTranslation } from 'react-i18next';
import { Plus, Settings2, Trees, Building2 } from 'lucide-react';
import { FloorZone, FloorZoneKind } from '../../../types';

interface Props {
  zones: FloorZone[];
  activeZoneId: string | null;
  editable: boolean;
  onSelect: (zoneId: string) => void;
  onAddZone: () => void;
  onOpenSettings: (zoneId: string) => void;
}

export default function ZoneTabs({ zones, activeZoneId, editable, onSelect, onAddZone, onOpenSettings }: Props) {
  const { t } = useTranslation(['floorPlan']);

  return (
    <div className="flex items-center gap-1 px-3 pt-2 bg-slate-50 border-b border-slate-200 overflow-x-auto">
      {zones.map((z) => {
        const active = z.id === activeZoneId;
        const Icon = z.kind === FloorZoneKind.OUTDOOR ? Trees : Building2;
        return (
          <button
            key={z.id}
            type="button"
            onClick={() => onSelect(z.id)}
            className={[
              'group flex items-center gap-1.5 px-3 h-9 rounded-t-lg text-sm whitespace-nowrap border-b-2 transition-colors',
              active ? 'bg-white border-primary-500 text-primary-700 font-medium' : 'border-transparent text-slate-500 hover:text-slate-700',
            ].join(' ')}
          >
            <Icon className="w-3.5 h-3.5" />
            {z.name}
            <span className="text-[11px] text-slate-400">({z.tables.length})</span>
            {active && editable && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onOpenSettings(z.id); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onOpenSettings(z.id); } }}
                className="ml-1 text-slate-400 hover:text-slate-700"
                aria-label={t('floorPlan:zoneSettings')}
              >
                <Settings2 className="w-3.5 h-3.5" />
              </span>
            )}
          </button>
        );
      })}
      {editable && (
        <button
          type="button"
          onClick={onAddZone}
          className="flex items-center gap-1 px-3 h-9 text-sm text-slate-500 hover:text-primary-600"
        >
          <Plus className="w-4 h-4" />
          {t('floorPlan:addZone')}
        </button>
      )}
    </div>
  );
}
