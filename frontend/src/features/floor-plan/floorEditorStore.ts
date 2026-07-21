import { create } from 'zustand';
import {
  FloorElement,
  FloorElementType,
  FloorPlan,
  FloorPlanTable,
  TableShape,
} from '../../types';
import {
  snap,
  snapPoint,
  clampCoord,
  clampTableSize,
  clampElementSize,
  normalizeRotation,
} from './geometry';

/**
 * Editor working-copy store. On load it ingests the server FloorPlan into a
 * local, freely-mutable copy; the canvas edits THIS copy (move/resize/rotate,
 * add/delete elements, (un)place tables) and "Save" diffs it back to the
 * server: locally-created elements are POSTed, removed ones DELETEd, and all
 * geometry (tables + surviving elements) goes through the bulk layout call.
 *
 * Undo/redo snapshot the whole working copy, so a delete or an add is just as
 * reversible as a drag.
 */

export interface EditorTable extends FloorPlanTable {}

export interface EditorElement extends FloorElement {
  /** True for an element created locally and not yet persisted. */
  _new?: boolean;
}

export type SelectionKind = 'table' | 'element';
export interface Selection {
  kind: SelectionKind;
  id: string;
}

interface Snapshot {
  tables: Record<string, EditorTable>;
  elements: Record<string, EditorElement>;
  deletedElementIds: string[];
}

/** Partial geometry patch in canvas terms (x/y map to posX/posY for tables). */
export interface GeometryPatch {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
}

interface FloorEditorState {
  loaded: boolean;
  activeZoneId: string | null;
  /**
   * Zone canvas dims captured at load — lets zone-targeted actions (e.g. the
   * Inspector's move-to-zone re-center) run store-side without zone props.
   */
  zoneMeta: Record<string, { canvasWidth: number; canvasHeight: number; gridSize: number }>;
  tables: Record<string, EditorTable>;
  elements: Record<string, EditorElement>;
  /** Persisted element ids the user removed; flushed on save. */
  deletedElementIds: string[];
  selection: Selection[];
  dirty: boolean;
  past: Snapshot[];
  future: Snapshot[];
  tempSeq: number;
  /**
   * Ids the user actually changed this session (moved/resized/rotated/(un)placed
   * /reshaped). Only these go into the bulk-save layout, so an untouched table
   * that another session concurrently deleted can't 404 the fail-closed save.
   * Monotonic + not snapshotted: re-sending a touched-then-undone row is a
   * harmless no-op (its id still exists), so undo need not rewind it.
   */
  touchedTableIds: Set<string>;
  touchedElementIds: Set<string>;

  // lifecycle
  load: (plan: FloorPlan, preferredZoneId?: string | null) => void;
  setActiveZone: (zoneId: string) => void;
  /**
   * Reconcile locally-created (_new, temp-id) elements with the server rows the
   * POST returned: swap each temp id for the real id, clear _new, remap any
   * selection. The page MUST call this with the create results before
   * markSavedClean — otherwise the next buildSavePayload re-POSTs them.
   */
  applyCreated: (created: Record<string, FloorElement>) => void;

  // selection
  select: (sel: Selection | null, additive?: boolean) => void;
  clearSelection: () => void;

  // geometry
  moveTable: (id: string, posX: number, posY: number, gridSize: number) => void;
  transformTable: (id: string, geo: Partial<Pick<EditorTable, 'posX' | 'posY' | 'width' | 'height' | 'rotation'>>) => void;
  setTableShape: (id: string, shape: TableShape) => void;
  assignTableToZone: (id: string, zoneId: string | null, posX?: number, posY?: number) => void;

  moveElement: (id: string, x: number, y: number, gridSize: number) => void;
  transformElement: (id: string, geo: Partial<Pick<EditorElement, 'x' | 'y' | 'width' | 'height' | 'rotation'>>) => void;
  setElementLabel: (id: string, label: string) => void;

  /** Inspector numeric fields — clamped exactly like transformTable/Element. */
  setTableGeometry: (id: string, patch: GeometryPatch) => void;
  setElementGeometry: (id: string, patch: GeometryPatch) => void;
  /**
   * Move every selected node by (dx, dy). `skipHistory` is for key-repeat: the
   * initial press pushes one undo entry, held-key repeats mutate in place so a
   * long nudge can't flood the 100-deep stack (one undo reverts the whole run).
   */
  nudgeSelected: (dx: number, dy: number, opts?: { skipHistory?: boolean }) => void;
  /** Re-zone an already-placed table and re-center it on the target zone. */
  moveTableToZone: (tableId: string, zoneId: string) => void;

  // structure
  addElement: (type: FloorElementType, zoneId: string, geo: { x: number; y: number; width: number; height: number; style?: Record<string, any>; label?: string }) => string;
  /** Clone the selected ELEMENTS (+16px offset, temp ids) and select the clones. */
  duplicateSelectedElements: () => void;
  deleteSelected: () => void;

  // history
  undo: () => void;
  redo: () => void;
  markSavedClean: () => void;

  // derived
  buildSavePayload: () => {
    creates: { zoneId: string; type: FloorElementType; x: number; y: number; width: number; height: number; rotation: number; style?: Record<string, any>; label?: string; tempId: string }[];
    deletes: string[];
    layout: {
      tables: { id: string; zoneId: string | null; posX: number; posY: number; width: number; height: number; rotation: number; shape: TableShape }[];
      elements: { id: string; x: number; y: number; width: number; height: number; rotation: number; points?: any; style?: Record<string, any> }[];
    };
  };
}

const snapshot = (s: FloorEditorState): Snapshot => ({
  tables: structuredClone(s.tables),
  elements: structuredClone(s.elements),
  deletedElementIds: [...s.deletedElementIds],
});

export const useFloorEditorStore = create<FloorEditorState>((set, get) => {
  /** Push current state onto the undo stack before a mutation; clears redo. */
  const pushHistory = (partial: Partial<FloorEditorState>) => {
    const s = get();
    set({
      past: [...s.past, snapshot(s)].slice(-100),
      future: [],
      dirty: true,
      ...partial,
    });
  };

  // Mark a row as user-changed. The touched Sets are not part of snapshots, so
  // mutate them in place (the ref survives every set() that omits them).
  const touchTable = (id: string) => get().touchedTableIds.add(id);
  const touchElement = (id: string) => get().touchedElementIds.add(id);

  // Sanitize a partial geometry update to the backend's value bounds so the
  // working copy is always saveable (a Transformer can hand us an out-of-range
  // or flipped size, or a cumulative rotation past ±360).
  const sanitizeTableGeo = (
    geo: Partial<Pick<EditorTable, 'posX' | 'posY' | 'width' | 'height' | 'rotation'>>,
  ) => {
    const out: typeof geo = { ...geo };
    if (out.posX !== undefined) out.posX = clampCoord(out.posX);
    if (out.posY !== undefined) out.posY = clampCoord(out.posY);
    if (out.width !== undefined) out.width = clampTableSize(out.width);
    if (out.height !== undefined) out.height = clampTableSize(out.height);
    if (out.rotation !== undefined) out.rotation = normalizeRotation(out.rotation);
    return out;
  };
  const sanitizeElementGeo = (
    geo: Partial<Pick<EditorElement, 'x' | 'y' | 'width' | 'height' | 'rotation'>>,
  ) => {
    const out: typeof geo = { ...geo };
    if (out.x !== undefined) out.x = clampCoord(out.x);
    if (out.y !== undefined) out.y = clampCoord(out.y);
    if (out.width !== undefined) out.width = clampElementSize(out.width);
    if (out.height !== undefined) out.height = clampElementSize(out.height);
    if (out.rotation !== undefined) out.rotation = normalizeRotation(out.rotation);
    return out;
  };

  return {
    loaded: false,
    activeZoneId: null,
    zoneMeta: {},
    tables: {},
    elements: {},
    deletedElementIds: [],
    selection: [],
    dirty: false,
    past: [],
    future: [],
    tempSeq: 0,
    touchedTableIds: new Set<string>(),
    touchedElementIds: new Set<string>(),

    load: (plan, preferredZoneId) => {
      const tables: Record<string, EditorTable> = {};
      const elements: Record<string, EditorElement> = {};
      const zoneMeta: FloorEditorState['zoneMeta'] = {};
      for (const z of plan.zones) {
        for (const t of z.tables) tables[t.id] = { ...t };
        for (const e of z.elements) elements[e.id] = { ...e };
        zoneMeta[z.id] = { canvasWidth: z.canvasWidth, canvasHeight: z.canvasHeight, gridSize: z.gridSize };
      }
      for (const t of plan.unplacedTables) tables[t.id] = { ...t };
      const zoneIds = plan.zones.map((z) => z.id);
      const activeZoneId =
        preferredZoneId && zoneIds.includes(preferredZoneId)
          ? preferredZoneId
          : zoneIds[0] ?? null;
      set({
        loaded: true,
        tables,
        elements,
        deletedElementIds: [],
        selection: [],
        dirty: false,
        past: [],
        future: [],
        tempSeq: 0,
        touchedTableIds: new Set<string>(),
        touchedElementIds: new Set<string>(),
        activeZoneId,
        zoneMeta,
      });
    },

    setActiveZone: (zoneId) => set({ activeZoneId: zoneId, selection: [] }),

    applyCreated: (created) => {
      const s = get();
      const elements = { ...s.elements };
      const touched = new Set(s.touchedElementIds);
      const remap = new Map<string, string>();
      for (const [tempId, serverEl] of Object.entries(created)) {
        if (elements[tempId]) delete elements[tempId];
        elements[serverEl.id] = { ...serverEl };
        touched.delete(tempId);
        remap.set(tempId, serverEl.id);
      }
      const selection = s.selection.map((sel) =>
        sel.kind === 'element' && remap.has(sel.id)
          ? { ...sel, id: remap.get(sel.id)! }
          : sel,
      );
      set({ elements, selection, touchedElementIds: touched });
    },

    select: (sel, additive) => {
      if (!sel) return set({ selection: [] });
      const cur = get().selection;
      if (additive) {
        const exists = cur.some((s) => s.id === sel.id && s.kind === sel.kind);
        set({
          selection: exists
            ? cur.filter((s) => !(s.id === sel.id && s.kind === sel.kind))
            : [...cur, sel],
        });
      } else {
        set({ selection: [sel] });
      }
    },

    clearSelection: () => set({ selection: [] }),

    moveTable: (id, posX, posY, gridSize) => {
      const t = get().tables[id];
      if (!t) return;
      touchTable(id);
      pushHistory({
        tables: {
          ...get().tables,
          [id]: {
            ...t,
            posX: clampCoord(snap(posX, gridSize)),
            posY: clampCoord(snap(posY, gridSize)),
          },
        },
      });
    },

    transformTable: (id, geo) => {
      const t = get().tables[id];
      if (!t) return;
      touchTable(id);
      pushHistory({
        tables: { ...get().tables, [id]: { ...t, ...sanitizeTableGeo(geo) } },
      });
    },

    setTableShape: (id, shape) => {
      const t = get().tables[id];
      if (!t) return;
      touchTable(id);
      pushHistory({ tables: { ...get().tables, [id]: { ...t, tableShape: shape } } });
    },

    assignTableToZone: (id, zoneId, posX, posY) => {
      const t = get().tables[id];
      if (!t) return;
      touchTable(id);
      pushHistory({
        tables: {
          ...get().tables,
          [id]: {
            ...t,
            zoneId,
            posX: clampCoord(posX ?? t.posX),
            posY: clampCoord(posY ?? t.posY),
          },
        },
      });
    },

    moveElement: (id, x, y, gridSize) => {
      const e = get().elements[id];
      if (!e) return;
      touchElement(id);
      pushHistory({
        elements: {
          ...get().elements,
          [id]: {
            ...e,
            x: clampCoord(snap(x, gridSize)),
            y: clampCoord(snap(y, gridSize)),
          },
        },
      });
    },

    transformElement: (id, geo) => {
      const e = get().elements[id];
      if (!e) return;
      touchElement(id);
      pushHistory({
        elements: { ...get().elements, [id]: { ...e, ...sanitizeElementGeo(geo) } },
      });
    },

    setElementLabel: (id, label) => {
      const e = get().elements[id];
      if (!e) return;
      touchElement(id);
      pushHistory({ elements: { ...get().elements, [id]: { ...e, label } } });
    },

    // The patches delegate to transform* (same clamps, touched + history). Only
    // defined keys are copied — spreading an explicit `x: undefined` through
    // would null the field out.
    setTableGeometry: (id, patch) => {
      const geo: Partial<Pick<EditorTable, 'posX' | 'posY' | 'width' | 'height' | 'rotation'>> = {};
      if (patch.x !== undefined) geo.posX = patch.x;
      if (patch.y !== undefined) geo.posY = patch.y;
      if (patch.width !== undefined) geo.width = patch.width;
      if (patch.height !== undefined) geo.height = patch.height;
      if (patch.rotation !== undefined) geo.rotation = patch.rotation;
      if (Object.keys(geo).length === 0) return;
      get().transformTable(id, geo);
    },

    setElementGeometry: (id, patch) => {
      const geo: Partial<Pick<EditorElement, 'x' | 'y' | 'width' | 'height' | 'rotation'>> = {};
      if (patch.x !== undefined) geo.x = patch.x;
      if (patch.y !== undefined) geo.y = patch.y;
      if (patch.width !== undefined) geo.width = patch.width;
      if (patch.height !== undefined) geo.height = patch.height;
      if (patch.rotation !== undefined) geo.rotation = patch.rotation;
      if (Object.keys(geo).length === 0) return;
      get().transformElement(id, geo);
    },

    nudgeSelected: (dx, dy, opts) => {
      const s = get();
      if (s.selection.length === 0) return;
      const tables = { ...s.tables };
      const elements = { ...s.elements };
      let changed = false;
      for (const sel of s.selection) {
        if (sel.kind === 'table') {
          const t = tables[sel.id];
          if (!t) continue;
          tables[sel.id] = { ...t, posX: clampCoord(t.posX + dx), posY: clampCoord(t.posY + dy) };
          touchTable(sel.id);
          changed = true;
        } else {
          const e = elements[sel.id];
          if (!e) continue;
          elements[sel.id] = { ...e, x: clampCoord(e.x + dx), y: clampCoord(e.y + dy) };
          touchElement(sel.id);
          changed = true;
        }
      }
      if (!changed) return;
      if (opts?.skipHistory) {
        set({ tables, elements, dirty: true });
      } else {
        pushHistory({ tables, elements });
      }
    },

    moveTableToZone: (tableId, zoneId) => {
      const s = get();
      const t = s.tables[tableId];
      const meta = s.zoneMeta[zoneId];
      if (!t || !meta || t.zoneId === zoneId) return;
      touchTable(tableId);
      const c = snapPoint(
        { x: meta.canvasWidth / 2 - t.width / 2, y: meta.canvasHeight / 2 - t.height / 2 },
        meta.gridSize,
      );
      pushHistory({
        tables: {
          ...s.tables,
          [tableId]: { ...t, zoneId, posX: clampCoord(c.x), posY: clampCoord(c.y) },
        },
      });
    },

    addElement: (type, zoneId, geo) => {
      const seq = get().tempSeq + 1;
      const tempId = `temp-el-${seq}`;
      const el: EditorElement = {
        id: tempId,
        zoneId,
        type,
        x: clampCoord(geo.x),
        y: clampCoord(geo.y),
        width: clampElementSize(geo.width),
        height: clampElementSize(geo.height),
        rotation: 0,
        points: null,
        style: geo.style ?? null,
        label: geo.label ?? null,
        zIndex: 0,
        _new: true,
      };
      pushHistory({
        elements: { ...get().elements, [tempId]: el },
        tempSeq: seq,
        selection: [{ kind: 'element', id: tempId }],
      });
      return tempId;
    },

    duplicateSelectedElements: () => {
      const s = get();
      const sources = s.selection
        .filter((sel) => sel.kind === 'element')
        .map((sel) => s.elements[sel.id])
        .filter(Boolean) as EditorElement[];
      if (sources.length === 0) return;
      let seq = s.tempSeq;
      const elements = { ...s.elements };
      const selection: Selection[] = [];
      for (const src of sources) {
        seq += 1;
        const tempId = `temp-el-${seq}`;
        elements[tempId] = {
          ...structuredClone(src),
          id: tempId,
          x: clampCoord(src.x + 16),
          y: clampCoord(src.y + 16),
          _new: true,
        };
        selection.push({ kind: 'element', id: tempId });
      }
      pushHistory({ elements, tempSeq: seq, selection });
    },

    deleteSelected: () => {
      const s = get();
      if (s.selection.length === 0) return;
      const elements = { ...s.elements };
      const tables = { ...s.tables };
      const deleted = [...s.deletedElementIds];
      for (const sel of s.selection) {
        if (sel.kind === 'element') {
          const el = elements[sel.id];
          if (!el) continue;
          delete elements[sel.id];
          // Only persisted elements need a server delete; temp ones vanish.
          if (!el._new) deleted.push(sel.id);
        } else if (sel.kind === 'table') {
          // Tables are never deleted from the floor plan — they're unplaced
          // (sent back to the tray) so the entity + its orders survive. Reset
          // its canvas geometry so a later re-place lands at the fresh drop
          // point rather than its old (often off-screen) ghost position.
          const t = tables[sel.id];
          if (t) {
            tables[sel.id] = { ...t, zoneId: null, posX: 0, posY: 0, rotation: 0 };
            touchTable(sel.id);
          }
        }
      }
      pushHistory({ elements, tables, deletedElementIds: deleted, selection: [] });
    },

    undo: () => {
      const s = get();
      if (s.past.length === 0) return;
      const prev = s.past[s.past.length - 1];
      const newPast = s.past.slice(0, -1);
      set({
        past: newPast,
        future: [snapshot(s), ...s.future].slice(0, 100),
        tables: prev.tables,
        elements: prev.elements,
        deletedElementIds: prev.deletedElementIds,
        // markSavedClean/load clear `past`, so an empty stack == the saved
        // baseline → not dirty. Undoing the last change must un-dirty too.
        dirty: newPast.length > 0,
        selection: [],
      });
    },

    redo: () => {
      const s = get();
      if (s.future.length === 0) return;
      const next = s.future[0];
      set({
        future: s.future.slice(1),
        past: [...s.past, snapshot(s)].slice(-100),
        tables: next.tables,
        elements: next.elements,
        deletedElementIds: next.deletedElementIds,
        dirty: true,
        selection: [],
      });
    },

    // Mark the working copy persisted. Call AFTER applyCreated so no _new
    // temp-id elements survive into the next buildSavePayload (double-create).
    markSavedClean: () =>
      set({
        dirty: false,
        deletedElementIds: [],
        past: [],
        future: [],
        touchedTableIds: new Set<string>(),
        touchedElementIds: new Set<string>(),
      }),

    buildSavePayload: () => {
      const s = get();
      const creates = Object.values(s.elements)
        .filter((e) => e._new)
        .map((e) => ({
          tempId: e.id,
          zoneId: e.zoneId,
          type: e.type,
          x: clampCoord(e.x),
          y: clampCoord(e.y),
          width: clampElementSize(e.width),
          height: clampElementSize(e.height),
          rotation: normalizeRotation(e.rotation),
          style: e.style ?? undefined,
          label: e.label ?? undefined,
        }));
      // Only persisted (non-_new) elements the user actually touched go into the
      // bulk layout; clamp/normalize as a final guard so the fail-closed save
      // can never be rejected 400 on a value the working copy let through.
      const layoutElements = Object.values(s.elements)
        .filter((e) => !e._new && s.touchedElementIds.has(e.id))
        .map((e) => ({
          id: e.id,
          x: clampCoord(e.x),
          y: clampCoord(e.y),
          width: clampElementSize(e.width),
          height: clampElementSize(e.height),
          rotation: normalizeRotation(e.rotation),
          points: e.points ?? undefined,
          style: e.style ?? undefined,
        }));
      // Only touched tables — an untouched table another session deleted must
      // not be in the payload (the fail-closed save 404s on a missing id).
      const layoutTables = Object.values(s.tables)
        .filter((t) => s.touchedTableIds.has(t.id))
        .map((t) => ({
          id: t.id,
          zoneId: t.zoneId,
          posX: clampCoord(t.posX),
          posY: clampCoord(t.posY),
          width: clampTableSize(t.width),
          height: clampTableSize(t.height),
          rotation: normalizeRotation(t.rotation),
          shape: t.tableShape,
        }));
      return {
        creates,
        deletes: s.deletedElementIds,
        layout: { tables: layoutTables, elements: layoutElements },
      };
    },
  };
});
