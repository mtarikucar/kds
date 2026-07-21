import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, MousePointerClick, Copy } from 'lucide-react';
import { FloorZone, TableShape } from '../../../types';
import type { EditorElement, EditorTable, GeometryPatch, Selection } from '../floorEditorStore';
import { TABLE_SHAPES } from '../constants';

interface Props {
  selection: Selection[];
  tables: Record<string, EditorTable>;
  elements: Record<string, EditorElement>;
  zones: FloorZone[];
  onSetTableShape: (id: string, shape: TableShape) => void;
  onSetElementLabel: (id: string, label: string) => void;
  onSetTableGeometry: (id: string, patch: GeometryPatch) => void;
  onSetElementGeometry: (id: string, patch: GeometryPatch) => void;
  onMoveTableToZone: (tableId: string, zoneId: string) => void;
  onDuplicateElements: () => void;
  onDeleteSelected: () => void;
}

/**
 * Numeric geometry input that commits on blur AND Enter. While focused it
 * holds a local draft; unfocused it derives from the prop, so a store-side
 * clamp always wins over whatever was typed.
 */
function GeoField({
  label, value, onCommit,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    setDraft(null);
    if (Number.isFinite(n) && n !== value) onCommit(n);
  };
  return (
    <label className="block">
      <span className="text-[11px] text-slate-500 mb-0.5 block">{label}</span>
      <input
        type="number"
        value={draft ?? String(Math.round(value * 100) / 100)}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setDraft(String(Math.round(value * 100) / 100))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="w-full h-8 px-2 rounded-lg border border-slate-200 text-sm focus:border-primary-400 focus:outline-none"
      />
    </label>
  );
}

function GeometryFields({
  x, y, width, height, rotation, onPatch,
}: {
  x: number; y: number; width: number; height: number; rotation: number;
  onPatch: (patch: GeometryPatch) => void;
}) {
  const { t } = useTranslation(['floorPlan']);
  return (
    <div>
      <div className="text-xs text-slate-500 mb-1.5">{t('floorPlan:inspector.geometry.title')}</div>
      <div className="grid grid-cols-2 gap-1.5">
        <GeoField label={t('floorPlan:inspector.geometry.x')} value={x} onCommit={(v) => onPatch({ x: v })} />
        <GeoField label={t('floorPlan:inspector.geometry.y')} value={y} onCommit={(v) => onPatch({ y: v })} />
        <GeoField label={t('floorPlan:inspector.geometry.width')} value={width} onCommit={(v) => onPatch({ width: v })} />
        <GeoField label={t('floorPlan:inspector.geometry.height')} value={height} onCommit={(v) => onPatch({ height: v })} />
        <GeoField label={t('floorPlan:inspector.geometry.rotation')} value={rotation} onCommit={(v) => onPatch({ rotation: v })} />
      </div>
    </div>
  );
}

export default function InspectorPanel({
  selection, tables, elements, zones,
  onSetTableShape, onSetElementLabel, onSetTableGeometry, onSetElementGeometry,
  onMoveTableToZone, onDuplicateElements, onDeleteSelected,
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
    const hasElement = selection.some((s) => s.kind === 'element');
    return (
      <div className="p-4 space-y-3">
        <div className="text-sm text-slate-600">{t('floorPlan:inspector.multi', { count: selection.length })}</div>
        {hasElement && (
          <button type="button" onClick={onDuplicateElements} className="w-full h-9 rounded-lg border border-slate-200 text-slate-600 text-sm flex items-center justify-center gap-2 hover:bg-slate-50">
            <Copy className="w-4 h-4" /> {t('floorPlan:inspector.duplicate')}
          </button>
        )}
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
        <GeometryFields
          x={table.posX}
          y={table.posY}
          width={table.width}
          height={table.height}
          rotation={table.rotation}
          onPatch={(patch) => onSetTableGeometry(table.id, patch)}
        />
        {zones.length > 0 && (
          <div>
            <label className="text-xs text-slate-500 mb-1.5 block">{t('floorPlan:inspector.moveToZone')}</label>
            <select
              value={table.zoneId ?? ''}
              onChange={(e) => {
                if (e.target.value && e.target.value !== table.zoneId) onMoveTableToZone(table.id, e.target.value);
              }}
              className="w-full h-9 px-2 rounded-lg border border-slate-200 text-sm bg-white focus:border-primary-400 focus:outline-none"
            >
              {table.zoneId === null && <option value="">—</option>}
              {zones.map((z) => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          </div>
        )}
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
      <GeometryFields
        x={el.x}
        y={el.y}
        width={el.width}
        height={el.height}
        rotation={el.rotation}
        onPatch={(patch) => onSetElementGeometry(el.id, patch)}
      />
      <button type="button" onClick={onDuplicateElements} className="w-full h-9 rounded-lg border border-slate-200 text-slate-600 text-sm flex items-center justify-center gap-2 hover:bg-slate-50">
        <Copy className="w-4 h-4" /> {t('floorPlan:inspector.duplicate')}
      </button>
      <button type="button" onClick={onDeleteSelected} className="w-full h-9 rounded-lg border border-red-200 text-red-600 text-sm flex items-center justify-center gap-2 hover:bg-red-50">
        <Trash2 className="w-4 h-4" /> {t('floorPlan:inspector.deleteElement')}
      </button>
    </div>
  );
}
