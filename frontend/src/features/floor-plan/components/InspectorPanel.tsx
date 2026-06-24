import { useTranslation } from 'react-i18next';
import { Trash2, MousePointerClick } from 'lucide-react';
import { TableShape } from '../../../types';
import type { EditorElement, EditorTable, Selection } from '../floorEditorStore';
import { TABLE_SHAPES } from '../constants';

interface Props {
  selection: Selection[];
  tables: Record<string, EditorTable>;
  elements: Record<string, EditorElement>;
  onSetTableShape: (id: string, shape: TableShape) => void;
  onSetElementLabel: (id: string, label: string) => void;
  onDeleteSelected: () => void;
}

export default function InspectorPanel({
  selection, tables, elements, onSetTableShape, onSetElementLabel, onDeleteSelected,
}: Props) {
  const { t } = useTranslation(['floorPlan', 'common']);

  if (selection.length === 0) {
    return (
      <div className="p-4 text-center text-slate-400 text-sm flex flex-col items-center gap-2 mt-8">
        <MousePointerClick className="w-8 h-8 text-slate-300" />
        {t('floorPlan:inspector.empty')}
      </div>
    );
  }

  if (selection.length > 1) {
    return (
      <div className="p-4 space-y-3">
        <div className="text-sm text-slate-600">{t('floorPlan:inspector.multi', { count: selection.length })}</div>
        <button type="button" onClick={onDeleteSelected} className="w-full h-9 rounded-lg border border-red-200 text-red-600 text-sm flex items-center justify-center gap-2 hover:bg-red-50">
          <Trash2 className="w-4 h-4" /> {t('floorPlan:inspector.removeSelected')}
        </button>
      </div>
    );
  }

  const sel = selection[0];
  if (sel.kind === 'table') {
    const table = tables[sel.id];
    if (!table) return null;
    return (
      <div className="p-4 space-y-4">
        <div>
          <div className="text-xs text-slate-400 uppercase tracking-wide">{t('floorPlan:inspector.table')}</div>
          <div className="text-lg font-semibold text-slate-900">#{table.number}</div>
          <div className="text-sm text-slate-500">{t('floorPlan:inspector.seats', { count: table.capacity })}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500 mb-1.5">{t('floorPlan:inspector.shape')}</div>
          <div className="grid grid-cols-3 gap-1.5">
            {TABLE_SHAPES.map((s) => (
              <button
                key={s.shape}
                type="button"
                onClick={() => onSetTableShape(table.id, s.shape)}
                className={[
                  'h-9 rounded-lg border text-xs transition-colors',
                  table.tableShape === s.shape ? 'bg-primary-50 border-primary-300 text-primary-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50',
                ].join(' ')}
              >
                {t(s.labelKey)}
              </button>
            ))}
          </div>
        </div>
        <button type="button" onClick={onDeleteSelected} className="w-full h-9 rounded-lg border border-amber-200 text-amber-700 text-sm flex items-center justify-center gap-2 hover:bg-amber-50">
          <Trash2 className="w-4 h-4" /> {t('floorPlan:inspector.unplaceTable')}
        </button>
        <p className="text-[11px] text-slate-400">{t('floorPlan:inspector.unplaceHint')}</p>
      </div>
    );
  }

  const el = elements[sel.id];
  if (!el) return null;
  const labelable = ['TEXT', 'BAR', 'KITCHEN', 'DECOR'].includes(el.type);
  return (
    <div className="p-4 space-y-4">
      <div>
        <div className="text-xs text-slate-400 uppercase tracking-wide">{t('floorPlan:inspector.element')}</div>
        <div className="text-lg font-semibold text-slate-900">{t(`floorPlan:elements.${el.type.toLowerCase()}`)}</div>
      </div>
      {labelable && (
        <div>
          <label className="text-xs text-slate-500 mb-1.5 block">{t('floorPlan:inspector.label')}</label>
          <input
            value={el.label ?? ''}
            onChange={(e) => onSetElementLabel(el.id, e.target.value)}
            className="w-full h-9 px-2.5 rounded-lg border border-slate-200 text-sm focus:border-primary-400 focus:outline-none"
            placeholder={t('floorPlan:inspector.labelPlaceholder')}
          />
        </div>
      )}
      <button type="button" onClick={onDeleteSelected} className="w-full h-9 rounded-lg border border-red-200 text-red-600 text-sm flex items-center justify-center gap-2 hover:bg-red-50">
        <Trash2 className="w-4 h-4" /> {t('floorPlan:inspector.deleteElement')}
      </button>
    </div>
  );
}
