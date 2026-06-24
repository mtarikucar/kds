import { useTranslation } from 'react-i18next';
import { PlusCircle } from 'lucide-react';
import type { EditorTable } from '../floorEditorStore';

interface Props {
  tables: EditorTable[];
  onPlace: (tableId: string) => void;
}

/**
 * Tables not yet placed on any zone. Clicking one drops it onto the active
 * zone (the page positions it). Empty when every table is placed.
 */
export default function UnplacedTray({ tables, onPlace }: Props) {
  const { t } = useTranslation(['floorPlan']);
  if (tables.length === 0) return null;

  return (
    <div className="border-t border-slate-200 bg-white px-3 py-2">
      <div className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">
        {t('floorPlan:unplaced', { count: tables.length })}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {tables.map((tbl) => (
          <button
            key={tbl.id}
            type="button"
            onClick={() => onPlace(tbl.id)}
            title={t('floorPlan:placeOnZone')}
            className="flex items-center gap-1.5 shrink-0 h-9 px-3 rounded-lg border border-dashed border-slate-300 text-sm text-slate-600 hover:border-primary-400 hover:text-primary-600 hover:bg-primary-50/50"
          >
            <PlusCircle className="w-4 h-4" />
            #{tbl.number}
            <span className="text-[11px] text-slate-400">· {tbl.capacity}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
