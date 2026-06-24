import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Map as MapIcon, Loader2 } from 'lucide-react';
import {
  useFloorPlan, useCreateZone, useUpdateZone, useDeleteZone,
  useCreateElement, useDeleteElement, useSaveLayout,
} from '../../features/floor-plan/floorPlanApi';
import { useCreateTable } from '../../features/tables/tablesApi';
import { useFloorEditorStore } from '../../features/floor-plan/floorEditorStore';
import { ELEMENT_PALETTE, DEFAULT_TABLE_SIZE } from '../../features/floor-plan/constants';
import { snapPoint } from '../../features/floor-plan/geometry';
import EditorToolbar from '../../features/floor-plan/components/EditorToolbar';
import ZoneTabs from '../../features/floor-plan/components/ZoneTabs';
import InspectorPanel from '../../features/floor-plan/components/InspectorPanel';
import UnplacedTray from '../../features/floor-plan/components/UnplacedTray';
import ZoneSettingsModal from '../../features/floor-plan/components/ZoneSettingsModal';
import FloorCanvas from '../../features/floor-plan/components/FloorCanvas';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import { FloorElementType, TableShape } from '../../types';

/** Measure a container element for the Konva stage. */
function useElementSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ width: Math.floor(r.width), height: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, size };
}

export default function FloorPlanEditorPage() {
  const { t } = useTranslation(['floorPlan', 'common']);
  const { data: plan, isLoading, refetch } = useFloorPlan();

  const store = useFloorEditorStore();
  const { ref: canvasWrapRef, size } = useElementSize();

  const createZone = useCreateZone();
  const updateZone = useUpdateZone();
  const deleteZone = useDeleteZone();
  const createElement = useCreateElement();
  const deleteElement = useDeleteElement();
  const saveLayout = useSaveLayout();
  const createTable = useCreateTable();

  const [showGrid, setShowGrid] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsZoneId, setSettingsZoneId] = useState<string | null>(null);
  const [newTable, setNewTable] = useState<{ shape: TableShape } | null>(null);
  const [newTableNumber, setNewTableNumber] = useState('');
  const [newTableCapacity, setNewTableCapacity] = useState(4);

  // Ingest the server plan into the working copy on first load + after a save
  // (when not mid-edit, so a background refetch can't clobber unsaved work).
  useEffect(() => {
    if (plan && !store.dirty) {
      store.load(plan, store.activeZoneId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> {t('common:loading', 'Loading…')}
      </div>
    );
  }

  const zones = plan?.zones ?? [];
  const activeZone = zones.find((z) => z.id === store.activeZoneId) ?? zones[0] ?? null;
  const settingsZone = zones.find((z) => z.id === settingsZoneId) ?? null;

  // Nodes for the active zone come from the working copy (store), not the
  // server snapshot, so live edits render immediately.
  const zoneTables = activeZone
    ? Object.values(store.tables).filter((tbl) => tbl.zoneId === activeZone.id)
    : [];
  const zoneElements = activeZone
    ? Object.values(store.elements).filter((e) => e.zoneId === activeZone.id)
    : [];
  const unplaced = Object.values(store.tables).filter((tbl) => tbl.zoneId === null);

  const centerOfZone = () =>
    activeZone
      ? snapPoint({ x: activeZone.canvasWidth / 2 - 40, y: activeZone.canvasHeight / 2 - 40 }, activeZone.gridSize)
      : { x: 100, y: 100 };

  const handleAddElement = (type: FloorElementType) => {
    if (!activeZone) return;
    const def = ELEMENT_PALETTE.find((e) => e.type === type)!;
    const c = centerOfZone();
    store.addElement(type, activeZone.id, {
      x: c.x, y: c.y, width: def.defaultWidth, height: def.defaultHeight,
      style: def.defaultStyle, label: type === 'TEXT' ? t('floorPlan:elements.text') : undefined,
    });
  };

  const handlePlaceTable = (tableId: string) => {
    if (!activeZone) return;
    const c = centerOfZone();
    store.assignTableToZone(tableId, activeZone.id, c.x, c.y);
  };

  const handleCreateTable = async () => {
    if (!activeZone || !newTable || !newTableNumber.trim()) return;
    const c = centerOfZone();
    try {
      await createTable.mutateAsync({
        number: newTableNumber.trim(),
        capacity: newTableCapacity,
        zoneId: activeZone.id,
        posX: c.x, posY: c.y,
        width: DEFAULT_TABLE_SIZE.width, height: DEFAULT_TABLE_SIZE.height,
        shape: newTable.shape,
      });
      setNewTable(null);
      setNewTableNumber('');
      setNewTableCapacity(4);
      const fresh = await refetch();
      if (fresh.data) store.load(fresh.data, activeZone.id);
    } catch {
      /* toast handled by the mutation */
    }
  };

  const handleAddZone = async () => {
    const name = window.prompt(t('floorPlan:newZonePrompt'));
    if (!name || !name.trim()) return;
    try {
      const zone = await createZone.mutateAsync({ name: name.trim() });
      const fresh = await refetch();
      if (fresh.data) store.load(fresh.data, zone.id);
    } catch {
      /* handled */
    }
  };

  const handleSave = async () => {
    const payload = store.buildSavePayload();
    setSaving(true);
    try {
      for (const c of payload.creates) {
        await createElement.mutateAsync({
          zoneId: c.zoneId, type: c.type, x: c.x, y: c.y,
          width: c.width, height: c.height, rotation: c.rotation,
          style: c.style, label: c.label,
        });
      }
      for (const id of payload.deletes) {
        await deleteElement.mutateAsync(id);
      }
      await saveLayout.mutateAsync({ tables: payload.layout.tables, elements: payload.layout.elements });
      store.markSavedClean();
      const fresh = await refetch();
      if (fresh.data) store.load(fresh.data, store.activeZoneId);
    } catch {
      toast.error(t('common:notifications.operationFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] -m-4 md:-m-6">
      {/* header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-200">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow">
          <MapIcon className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="font-heading font-bold text-slate-900 text-xl">{t('floorPlan:title')}</h1>
          <p className="text-slate-500 text-sm">{t('floorPlan:subtitle')}</p>
        </div>
      </div>

      <EditorToolbar
        dirty={store.dirty}
        saving={saving}
        canUndo={store.past.length > 0}
        canRedo={store.future.length > 0}
        showGrid={showGrid}
        onAddTable={(shape) => setNewTable({ shape })}
        onAddElement={handleAddElement}
        onUndo={store.undo}
        onRedo={store.redo}
        onToggleGrid={() => setShowGrid((g) => !g)}
        onSave={handleSave}
      />

      <ZoneTabs
        zones={zones}
        activeZoneId={activeZone?.id ?? null}
        editable
        onSelect={store.setActiveZone}
        onAddZone={handleAddZone}
        onOpenSettings={setSettingsZoneId}
      />

      <div className="flex flex-1 min-h-0">
        <div ref={canvasWrapRef} className="flex-1 min-w-0 relative">
          {activeZone && size.width > 0 ? (
            <FloorCanvas
              zone={activeZone}
              tables={zoneTables}
              elements={zoneElements}
              selection={store.selection}
              editable
              showGrid={showGrid}
              width={size.width}
              height={size.height}
              onSelect={(sel, additive) => store.select(sel, additive)}
              onTableDragEnd={(id, posX, posY) => store.moveTable(id, posX, posY, activeZone.gridSize)}
              onTableTransformEnd={(id, geo) => store.transformTable(id, geo)}
              onElementDragEnd={(id, x, y) => store.moveElement(id, x, y, activeZone.gridSize)}
              onElementTransformEnd={(id, geo) => store.transformElement(id, geo)}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-slate-400 text-sm px-6 text-center">
              {zones.length === 0 ? t('floorPlan:noZones') : t('common:loading', 'Loading…')}
            </div>
          )}
        </div>

        <aside className="w-72 shrink-0 border-l border-slate-200 bg-white overflow-y-auto hidden lg:block">
          <InspectorPanel
            selection={store.selection}
            tables={store.tables}
            elements={store.elements}
            onSetTableShape={store.setTableShape}
            onSetElementLabel={store.setElementLabel}
            onDeleteSelected={store.deleteSelected}
          />
        </aside>
      </div>

      <UnplacedTray tables={unplaced} onPlace={handlePlaceTable} />

      {settingsZone && (
        <ZoneSettingsModal
          zone={settingsZone}
          isOpen={!!settingsZone}
          onClose={() => setSettingsZoneId(null)}
          saving={updateZone.isPending}
          onSave={async (dto) => {
            await updateZone.mutateAsync({ id: settingsZone.id, dto });
            setSettingsZoneId(null);
            const fresh = await refetch();
            if (fresh.data) store.load(fresh.data, settingsZone.id);
          }}
          onDelete={async () => {
            if (!window.confirm(t('floorPlan:zone.deleteConfirm', { name: settingsZone.name }))) return;
            await deleteZone.mutateAsync(settingsZone.id);
            setSettingsZoneId(null);
            const fresh = await refetch();
            if (fresh.data) store.load(fresh.data, fresh.data.zones[0]?.id ?? null);
          }}
        />
      )}

      {/* quick "new table" modal */}
      <Modal isOpen={!!newTable} onClose={() => setNewTable(null)} title={t('floorPlan:newTable')} size="sm">
        <div className="space-y-4">
          <label className="block">
            <span className="text-xs text-slate-500 mb-1 block">{t('floorPlan:tableNumber')}</span>
            <input autoFocus value={newTableNumber} onChange={(e) => setNewTableNumber(e.target.value)} maxLength={32}
              className="w-full h-9 px-2.5 rounded-lg border border-slate-200 text-sm focus:border-primary-400 focus:outline-none" />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500 mb-1 block">{t('floorPlan:capacity')}</span>
            <input type="number" min={1} max={200} value={newTableCapacity} onChange={(e) => setNewTableCapacity(Number(e.target.value))}
              className="w-full h-9 px-2.5 rounded-lg border border-slate-200 text-sm focus:border-primary-400 focus:outline-none" />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setNewTable(null)}>{t('common:cancel', 'Cancel')}</Button>
            <Button variant="primary" onClick={handleCreateTable} isLoading={createTable.isPending} disabled={!newTableNumber.trim()}>
              {t('common:add', 'Add')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
