import { create } from 'zustand';
import {
  FloorElement,
  FloorElementType,
  FloorPlan,
  FloorPlanTable,
  TableShape,
} from '../../types';
import { snap } from './geometry';

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

interface FloorEditorState {
  loaded: boolean;
  activeZoneId: string | null;
  tables: Record<string, EditorTable>;
  elements: Record<string, EditorElement>;
  /** Persisted element ids the user removed; flushed on save. */
  deletedElementIds: string[];
  selection: Selection[];
  dirty: boolean;
  past: Snapshot[];
  future: Snapshot[];
  tempSeq: number;

  // lifecycle
  load: (plan: FloorPlan, preferredZoneId?: string | null) => void;
  setActiveZone: (zoneId: string) => void;

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

  // structure
  addElement: (type: FloorElementType, zoneId: string, geo: { x: number; y: number; width: number; height: number; style?: Record<string, any>; label?: string }) => string;
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

  return {
    loaded: false,
    activeZoneId: null,
    tables: {},
    elements: {},
    deletedElementIds: [],
    selection: [],
    dirty: false,
    past: [],
    future: [],
    tempSeq: 0,

    load: (plan, preferredZoneId) => {
      const tables: Record<string, EditorTable> = {};
      const elements: Record<string, EditorElement> = {};
      for (const z of plan.zones) {
        for (const t of z.tables) tables[t.id] = { ...t };
        for (const e of z.elements) elements[e.id] = { ...e };
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
        activeZoneId,
      });
    },

    setActiveZone: (zoneId) => set({ activeZoneId: zoneId, selection: [] }),

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
      pushHistory({
        tables: { ...get().tables, [id]: { ...t, posX: snap(posX, gridSize), posY: snap(posY, gridSize) } },
      });
    },

    transformTable: (id, geo) => {
      const t = get().tables[id];
      if (!t) return;
      pushHistory({ tables: { ...get().tables, [id]: { ...t, ...geo } } });
    },

    setTableShape: (id, shape) => {
      const t = get().tables[id];
      if (!t) return;
      pushHistory({ tables: { ...get().tables, [id]: { ...t, tableShape: shape } } });
    },

    assignTableToZone: (id, zoneId, posX, posY) => {
      const t = get().tables[id];
      if (!t) return;
      pushHistory({
        tables: {
          ...get().tables,
          [id]: { ...t, zoneId, posX: posX ?? t.posX, posY: posY ?? t.posY },
        },
      });
    },

    moveElement: (id, x, y, gridSize) => {
      const e = get().elements[id];
      if (!e) return;
      pushHistory({
        elements: { ...get().elements, [id]: { ...e, x: snap(x, gridSize), y: snap(y, gridSize) } },
      });
    },

    transformElement: (id, geo) => {
      const e = get().elements[id];
      if (!e) return;
      pushHistory({ elements: { ...get().elements, [id]: { ...e, ...geo } } });
    },

    setElementLabel: (id, label) => {
      const e = get().elements[id];
      if (!e) return;
      pushHistory({ elements: { ...get().elements, [id]: { ...e, label } } });
    },

    addElement: (type, zoneId, geo) => {
      const seq = get().tempSeq + 1;
      const tempId = `temp-el-${seq}`;
      const el: EditorElement = {
        id: tempId,
        zoneId,
        type,
        x: geo.x,
        y: geo.y,
        width: geo.width,
        height: geo.height,
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
          // (sent back to the tray) so the entity + its orders survive.
          const t = tables[sel.id];
          if (t) tables[sel.id] = { ...t, zoneId: null };
        }
      }
      pushHistory({ elements, tables, deletedElementIds: deleted, selection: [] });
    },

    undo: () => {
      const s = get();
      if (s.past.length === 0) return;
      const prev = s.past[s.past.length - 1];
      set({
        past: s.past.slice(0, -1),
        future: [snapshot(s), ...s.future].slice(0, 100),
        tables: prev.tables,
        elements: prev.elements,
        deletedElementIds: prev.deletedElementIds,
        dirty: true,
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

    markSavedClean: () => set({ dirty: false, deletedElementIds: [], past: [], future: [] }),

    buildSavePayload: () => {
      const s = get();
      const creates = Object.values(s.elements)
        .filter((e) => e._new)
        .map((e) => ({
          tempId: e.id,
          zoneId: e.zoneId,
          type: e.type,
          x: e.x,
          y: e.y,
          width: e.width,
          height: e.height,
          rotation: e.rotation,
          style: e.style ?? undefined,
          label: e.label ?? undefined,
        }));
      const layoutElements = Object.values(s.elements)
        .filter((e) => !e._new)
        .map((e) => ({
          id: e.id,
          x: e.x,
          y: e.y,
          width: e.width,
          height: e.height,
          rotation: e.rotation,
          points: e.points ?? undefined,
          style: e.style ?? undefined,
        }));
      const layoutTables = Object.values(s.tables).map((t) => ({
        id: t.id,
        zoneId: t.zoneId,
        posX: t.posX,
        posY: t.posY,
        width: t.width,
        height: t.height,
        rotation: t.rotation,
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
