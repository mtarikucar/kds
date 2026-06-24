import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Map as MapIcon } from 'lucide-react';
import { useFloorPlan } from '../floorPlanApi';
import { useFloorPlanSocket } from '../useFloorPlanSocket';
import { FloorPlanTable, TableStatus } from '../../../types';
import { getTableStatusLabel } from '../../../lib/tableStatus';
import FloorCanvas from './FloorCanvas';
import ZoneTabs from './ZoneTabs';
import type { EditorElement, EditorTable } from '../floorEditorStore';

function useElementSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      setSize({ width: Math.floor(r.width), height: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, size };
}

const STATUS_DOT: Record<TableStatus, string> = {
  [TableStatus.AVAILABLE]: 'bg-emerald-500',
  [TableStatus.OCCUPIED]: 'bg-red-500',
  [TableStatus.RESERVED]: 'bg-amber-500',
};

interface Props {
  /** Fired when a table on the live map is tapped (open order, change status…). */
  onTableClick?: (table: FloorPlanTable) => void;
  /** Optional empty-state CTA (e.g. link to the editor) when no zones exist. */
  emptyAction?: React.ReactNode;
}

/**
 * Read-only, real-time floor map. Renders the designed plan (zones + elements
 * + tables) with live status colors + active-order badges, kept fresh over
 * sockets. Tapping a table calls onTableClick. Used by the Tables page and the
 * POS floor.
 */
export default function LiveFloorMap({ onTableClick, emptyAction }: Props) {
  const { t } = useTranslation(['floorPlan', 'common']);
  const { data: plan, isLoading } = useFloorPlan();
  useFloorPlanSocket();

  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  const { ref: wrapRef, size } = useElementSize();

  // `!plan` covers the branch-unresolved case: useFloorPlan is enabled:!!branchId,
  // so while branchId is null the query is idle (isLoading false) with no data —
  // show the loader, not the misleading "no zones designed yet" empty state.
  if (isLoading || !plan) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> {t('floorPlan:loading')}
      </div>
    );
  }

  const zones = plan?.zones ?? [];
  if (zones.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center text-slate-400 gap-3 px-6">
        <MapIcon className="w-10 h-10 text-slate-300" />
        <p>{t('floorPlan:noZonesLive')}</p>
        {emptyAction}
      </div>
    );
  }

  const activeZone = zones.find((z) => z.id === activeZoneId) ?? zones[0];

  return (
    <div className="flex flex-col h-full">
      <ZoneTabs
        zones={zones}
        activeZoneId={activeZone.id}
        editable={false}
        onSelect={setActiveZoneId}
        onAddZone={() => {}}
        onOpenSettings={() => {}}
      />
      <div ref={wrapRef} className="flex-1 min-h-0 relative">
        {size.width > 0 && (
          <FloorCanvas
            zone={activeZone}
            tables={activeZone.tables as EditorTable[]}
            elements={activeZone.elements as EditorElement[]}
            selection={[]}
            editable={false}
            showGrid={false}
            width={size.width}
            height={size.height}
            onSelect={(sel) => {
              if (sel?.kind === 'table' && onTableClick) {
                const tbl = activeZone.tables.find((x) => x.id === sel.id);
                if (tbl) onTableClick(tbl);
              }
            }}
            onTableDragEnd={() => {}}
            onTableTransformEnd={() => {}}
            onElementDragEnd={() => {}}
            onElementTransformEnd={() => {}}
          />
        )}
        {/* status legend */}
        <div className="absolute top-3 left-3 flex flex-wrap gap-3 bg-white/85 backdrop-blur rounded-lg px-3 py-1.5 shadow-sm text-xs">
          {(Object.keys(STATUS_DOT) as TableStatus[]).map((s) => (
            <span key={s} className="flex items-center gap-1.5 text-slate-600">
              <span className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT[s]}`} />
              {getTableStatusLabel(s, t)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
