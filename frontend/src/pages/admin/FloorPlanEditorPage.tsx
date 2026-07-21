import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Map as MapIcon, Loader2, MousePointerClick, X } from 'lucide-react';
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

/**
 * The 2D floor-plan editor. Rendered standalone (its own header) OR embedded
 * inside the Tables page as the "Salon Planı" mode (`embedded` hides the header
 * and drops the full-viewport negative margins so it fits under the mode
 * switcher). Folding it into Tables removes the separate sidebar tab.
 */
export default function FloorPlanEditorPage({
  embedded = false,
}: {
  embedded?: boolean;
}) {
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
  // Zone-create modal — replaces the old window.prompt() (which offered no
  // validation, no cancel affordance and looked jarring inside the app shell).
  const [addingZone, setAddingZone] = useState(false);
  const [newZoneName, setNewZoneName] = useState('');
  // Zone-delete confirm modal — replaces the app's last window.confirm().
  const [confirmingZoneDelete, setConfirmingZoneDelete] = useState(false);
  // Click-to-place: a palette button ARMS an element type; the next canvas
  // click drops it there (Shift+click keeps it armed for rapid multi-place).
  const [armedElement, setArmedElement] = useState<FloorElementType | null>(null);
  const [placeHintDismissed, setPlaceHintDismissed] = useState(false);
  // Consecutive center drops cascade so repeated adds never stack invisibly.
  const centerDropSeq = useRef(0);

  // Ingest the server plan into the working copy on first load + after a save
  // (when not mid-edit, so a background refetch can't clobber unsaved work).
  useEffect(() => {
    if (plan && !store.dirty) {
      store.load(plan, store.activeZoneId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  // Editor keyboard shortcuts. Reads store state via getState() so the handler
  // never goes stale; suppressed while typing or while any modal is open (all
  // app modals render role="dialog").
  useEffect(() => {
    const ARROW_DELTAS: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const isTypingTarget = (el: EventTarget | null) =>
      el instanceof HTMLElement &&
      (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || document.querySelector('[role="dialog"]')) return;
      const s = useFloorEditorStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        s.deleteSelected();
        return;
      }
      if (e.key === 'Escape') {
        setArmedElement(null);
        s.clearSelection();
        return;
      }
      const delta = ARROW_DELTAS[e.key];
      if (delta && s.selection.length > 0) {
        e.preventDefault();
        const zone = plan?.zones.find((z) => z.id === s.activeZoneId) ?? plan?.zones[0];
        // Arrow = one grid cell, Shift+Arrow = fine 1-unit; key repeat skips
        // history so a held key is a single undo step.
        const step = e.shiftKey ? 1 : Math.max(1, zone?.gridSize ?? 1);
        s.nudgeSelected(delta[0] * step, delta[1] * step, { skipHistory: e.repeat });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [plan]);

  // Warn before the tab unloads while there are unsaved edits.
  useEffect(() => {
    if (!store.dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [store.dirty]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> {t('floorPlan:loading')}
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

  // One props bag — the inspector renders twice (lg sidebar + mobile sheet).
  const inspectorProps = {
    selection: store.selection,
    tables: store.tables,
    elements: store.elements,
    zones,
    onSetTableShape: store.setTableShape,
    onSetElementLabel: store.setElementLabel,
    onSetTableGeometry: store.setTableGeometry,
    onSetElementGeometry: store.setElementGeometry,
    onMoveTableToZone: store.moveTableToZone,
    onDuplicateElements: store.duplicateSelectedElements,
    onDeleteSelected: store.deleteSelected,
  };

  // Center drop point with a per-drop cascade: each consecutive center drop
  // shifts +24px (or one grid cell when the grid is coarser, so snapping can't
  // collapse two drops onto the same cell).
  const nextCenterDrop = () => {
    if (!activeZone) return { x: 100, y: 100 };
    const step = Math.max(24, activeZone.gridSize || 0);
    const off = (centerDropSeq.current++ % 10) * step;
    return snapPoint(
      { x: activeZone.canvasWidth / 2 - 40 + off, y: activeZone.canvasHeight / 2 - 40 + off },
      activeZone.gridSize,
    );
  };

  // Palette buttons toggle the armed type; the actual add happens on canvas click.
  const handleArmElement = (type: FloorElementType) => {
    setArmedElement((cur) => (cur === type ? null : type));
  };

  const handleCanvasClick = (x: number, y: number, opts: { shiftKey: boolean }) => {
    if (!armedElement || !activeZone) return;
    const def = ELEMENT_PALETTE.find((p) => p.type === armedElement)!;
    // center the new element on the click point, snapped to the grid
    const p = snapPoint(
      { x: x - def.defaultWidth / 2, y: y - def.defaultHeight / 2 },
      activeZone.gridSize,
    );
    store.addElement(armedElement, activeZone.id, {
      x: p.x, y: p.y, width: def.defaultWidth, height: def.defaultHeight,
      style: def.defaultStyle, label: armedElement === 'TEXT' ? t('floorPlan:elements.text') : undefined,
    });
    if (!opts.shiftKey) setArmedElement(null);
  };

  const handlePlaceTable = (tableId: string) => {
    if (!activeZone) return;
    const c = nextCenterDrop();
    store.assignTableToZone(tableId, activeZone.id, c.x, c.y);
  };

  const handleCreateTable = async () => {
    if (!activeZone || !newTable || !newTableNumber.trim()) return;
    const c = nextCenterDrop();
    try {
      await createTable.mutateAsync({
        number: newTableNumber.trim(),
        // Clamp to the backend bounds so a cleared field (→ 0) can't 400.
        capacity: Math.min(200, Math.max(1, Number(newTableCapacity) || 1)),
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
    const name = newZoneName.trim();
    if (!name) return;
    try {
      const zone = await createZone.mutateAsync({ name });
      setAddingZone(false);
      setNewZoneName('');
      const fresh = await refetch();
      if (fresh.data) store.load(fresh.data, zone.id);
    } catch {
      /* handled */
    }
  };

  const handleDeleteZone = async () => {
    if (!settingsZone) return;
    try {
      await deleteZone.mutateAsync(settingsZone.id);
      setConfirmingZoneDelete(false);
      setSettingsZoneId(null);
      const fresh = await refetch();
      if (fresh.data) store.load(fresh.data, fresh.data.zones[0]?.id ?? null);
    } catch {
      /* toast handled by the mutation */
    }
  };

  const handleSave = async () => {
    const payload = store.buildSavePayload();
    setSaving(true);
    try {
      // Create new elements one at a time and reconcile each success into the
      // store IMMEDIATELY (temp id → server id, clears _new). So if a later
      // step throws, the store no longer holds the just-created element as a
      // pending create — a retry sends only what's truly left (no duplicate
      // POST). Deletes are idempotent (the hook swallows 404).
      for (const c of payload.creates) {
        const created = await createElement.mutateAsync({
          zoneId: c.zoneId, type: c.type, x: c.x, y: c.y,
          width: c.width, height: c.height, rotation: c.rotation,
          style: c.style, label: c.label,
        });
        store.applyCreated({ [c.tempId]: created });
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
    <div
      className={
        embedded
          ? 'flex flex-col h-[calc(100vh-15rem)] min-h-[28rem] rounded-2xl border border-slate-200/60 bg-white overflow-hidden'
          : 'flex flex-col h-[calc(100vh-7rem)] -m-4 md:-m-6'
      }
    >
      {/* header — hidden when embedded in the Tables page (which supplies its
          own header + mode switcher). */}
      {!embedded && (
        <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-200">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow">
            <MapIcon className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-heading font-bold text-slate-900 text-xl">{t('floorPlan:title')}</h1>
            <p className="text-slate-500 text-sm">{t('floorPlan:subtitle')}</p>
          </div>
        </div>
      )}

      <EditorToolbar
        dirty={store.dirty}
        saving={saving}
        canUndo={store.past.length > 0}
        canRedo={store.future.length > 0}
        showGrid={showGrid}
        armedElement={armedElement}
        onAddTable={(shape) => setNewTable({ shape })}
        onAddElement={handleArmElement}
        onUndo={store.undo}
        onRedo={store.redo}
        onToggleGrid={() => setShowGrid((g) => !g)}
        onSave={handleSave}
      />

      <ZoneTabs
        zones={zones}
        activeZoneId={activeZone?.id ?? null}
        editable
        onSelect={(zoneId) => {
          centerDropSeq.current = 0; // cascade restarts per zone
          store.setActiveZone(zoneId);
        }}
        onAddZone={() => {
          setNewZoneName('');
          setAddingZone(true);
        }}
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
              placing={!!armedElement}
              onSelect={(sel, additive) => store.select(sel, additive)}
              onTableDragEnd={(id, posX, posY) => store.moveTable(id, posX, posY, activeZone.gridSize)}
              onTableTransformEnd={(id, geo) => store.transformTable(id, geo)}
              onElementDragEnd={(id, x, y) => store.moveElement(id, x, y, activeZone.gridSize)}
              onElementTransformEnd={(id, geo) => store.transformElement(id, geo)}
              onCanvasClick={handleCanvasClick}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-slate-400 text-sm px-6 text-center">
              {zones.length === 0 ? t('floorPlan:noZones') : t('common:loading', 'Loading…')}
            </div>
          )}
          {armedElement && !placeHintDismissed && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-full bg-slate-900/85 text-white text-xs shadow-lg whitespace-nowrap">
              <MousePointerClick className="w-3.5 h-3.5 shrink-0" />
              <span>{t('floorPlan:placementHint')}</span>
              <button
                type="button"
                onClick={() => setPlaceHintDismissed(true)}
                aria-label={t('common:app.close')}
                className="p-0.5 rounded-full text-white/70 hover:text-white hover:bg-white/10"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        <aside className="w-72 shrink-0 border-l border-slate-200 bg-white overflow-y-auto hidden lg:block">
          <InspectorPanel {...inspectorProps} />
        </aside>
      </div>

      {/* Below lg the sidebar is hidden — surface the inspector as a bottom
          sheet whenever something is selected so it stays reachable on tablets. */}
      {store.selection.length > 0 && (
        <div className="lg:hidden fixed inset-x-0 bottom-0 z-40 rounded-t-2xl border-t border-slate-200 bg-white shadow-[0_-8px_24px_rgba(15,23,42,0.18)] max-h-[45vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          <div className="sticky top-0 z-10 flex items-center bg-white px-4 pt-2 pb-1">
            <span className="w-8 h-1 rounded-full bg-slate-200 mx-auto" aria-hidden="true" />
            <button
              type="button"
              onClick={store.clearSelection}
              aria-label={t('common:app.close')}
              className="absolute right-3 top-2 p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <InspectorPanel {...inspectorProps} />
        </div>
      )}

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
          onDelete={() => setConfirmingZoneDelete(true)}
        />
      )}

      {/* zone-delete confirm — styled like the new-area modal, no window.confirm */}
      <Modal
        isOpen={confirmingZoneDelete && !!settingsZone}
        onClose={() => setConfirmingZoneDelete(false)}
        title={t('floorPlan:zone.deleteTitle')}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {t('floorPlan:zone.deleteBody', { name: settingsZone?.name })}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmingZoneDelete(false)}>
              {t('common:app.cancel')}
            </Button>
            <Button variant="danger" onClick={handleDeleteZone} isLoading={deleteZone.isPending}>
              {t('floorPlan:zone.deleteAction')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* new-area modal — replaces window.prompt() */}
      <Modal
        isOpen={addingZone}
        onClose={() => setAddingZone(false)}
        title={t('floorPlan:addZone')}
        size="sm"
      >
        <div className="space-y-4">
          <label className="block">
            <span className="text-xs text-slate-500 mb-1 block">{t('floorPlan:zone.name')}</span>
            <input
              autoFocus
              value={newZoneName}
              onChange={(e) => setNewZoneName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newZoneName.trim()) handleAddZone();
              }}
              maxLength={64}
              placeholder={t('floorPlan:newZonePrompt')}
              className="w-full h-9 px-2.5 rounded-lg border border-slate-200 text-sm focus:border-primary-400 focus:outline-none"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAddingZone(false)}>
              {t('common:app.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={handleAddZone}
              isLoading={createZone.isPending}
              disabled={!newZoneName.trim()}
            >
              {t('common:app.add')}
            </Button>
          </div>
        </div>
      </Modal>

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
            <Button variant="outline" onClick={() => setNewTable(null)}>{t('common:app.cancel')}</Button>
            <Button variant="primary" onClick={handleCreateTable} isLoading={createTable.isPending} disabled={!newTableNumber.trim()}>
              {t('common:app.add')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
