import { describe, it, expect, beforeEach } from 'vitest';
import { useFloorEditorStore } from './floorEditorStore';
import {
  FloorElementType,
  FloorPlan,
  TableShape,
  TableStatus,
} from '../../types';

const plan = (): FloorPlan => ({
  zones: [
    {
      id: 'z1',
      name: 'Kat 1',
      sortOrder: 0,
      kind: 'INDOOR' as any,
      canvasWidth: 1200,
      canvasHeight: 800,
      gridSize: 20,
      backgroundOpacity: 1,
      elements: [
        { id: 'e1', zoneId: 'z1', type: FloorElementType.WALL, x: 10, y: 10, width: 200, height: 12, rotation: 0, points: null, style: null, label: null, zIndex: 0 },
      ],
      tables: [
        { id: 't1', number: '1', capacity: 4, status: TableStatus.AVAILABLE, zoneId: 'z1', posX: 100, posY: 100, width: 80, height: 80, rotation: 0, tableShape: TableShape.ROUND, activeOrderCount: 0 },
      ],
    },
  ],
  unplacedTables: [
    { id: 't2', number: '2', capacity: 2, status: TableStatus.AVAILABLE, zoneId: null, posX: 0, posY: 0, width: 80, height: 80, rotation: 0, tableShape: TableShape.SQUARE, activeOrderCount: 0 },
  ],
});

const store = () => useFloorEditorStore.getState();

describe('floorEditorStore', () => {
  beforeEach(() => {
    useFloorEditorStore.setState({ loaded: false, tables: {}, elements: {}, deletedElementIds: [], selection: [], dirty: false, past: [], future: [], tempSeq: 0, activeZoneId: null });
    store().load(plan());
  });

  it('ingests zones + unplaced tables into a flat working copy', () => {
    const s = store();
    expect(s.loaded).toBe(true);
    expect(Object.keys(s.tables).sort()).toEqual(['t1', 't2']);
    expect(Object.keys(s.elements)).toEqual(['e1']);
    expect(s.activeZoneId).toBe('z1');
    expect(s.dirty).toBe(false);
  });

  it('moveTable snaps to the grid and marks dirty', () => {
    store().moveTable('t1', 103, 117, 20);
    const t = store().tables.t1;
    expect(t.posX).toBe(100);
    expect(t.posY).toBe(120);
    expect(store().dirty).toBe(true);
  });

  it('addElement creates a local temp element selected, included in save creates', () => {
    const id = store().addElement(FloorElementType.BAR, 'z1', { x: 40, y: 40, width: 220, height: 60 });
    expect(id).toMatch(/^temp-el-/);
    expect(store().elements[id]._new).toBe(true);
    expect(store().selection).toEqual([{ kind: 'element', id }]);
    const payload = store().buildSavePayload();
    expect(payload.creates).toHaveLength(1);
    expect(payload.creates[0]).toMatchObject({ type: 'BAR', zoneId: 'z1', tempId: id });
    // a temp element must NOT appear in the geometry layout list
    expect(payload.layout.elements.find((e) => e.id === id)).toBeUndefined();
  });

  it('deleteSelected removes a persisted element (queued for server delete) and unplaces a table', () => {
    store().select({ kind: 'element', id: 'e1' });
    store().deleteSelected();
    expect(store().elements.e1).toBeUndefined();
    expect(store().deletedElementIds).toContain('e1');

    store().select({ kind: 'table', id: 't1' });
    store().deleteSelected();
    expect(store().tables.t1.zoneId).toBeNull(); // unplaced, not destroyed
  });

  it('a deleted temp element is dropped without a server delete', () => {
    const id = store().addElement(FloorElementType.PLANT, 'z1', { x: 0, y: 0, width: 48, height: 48 });
    store().select({ kind: 'element', id });
    store().deleteSelected();
    expect(store().elements[id]).toBeUndefined();
    expect(store().deletedElementIds).not.toContain(id);
  });

  it('undo/redo reverse and reapply a move', () => {
    store().moveTable('t1', 300, 300, 20);
    expect(store().tables.t1.posX).toBe(300);
    store().undo();
    expect(store().tables.t1.posX).toBe(100);
    store().redo();
    expect(store().tables.t1.posX).toBe(300);
  });

  it('buildSavePayload emits every table geometry + zone assignment', () => {
    store().assignTableToZone('t2', 'z1', 200, 200); // place the unplaced table
    const payload = store().buildSavePayload();
    const t2 = payload.layout.tables.find((t) => t.id === 't2');
    expect(t2).toMatchObject({ zoneId: 'z1', posX: 200, posY: 200, shape: 'SQUARE' });
    expect(payload.layout.tables).toHaveLength(2);
  });

  it('setTableShape updates the shape in the save payload', () => {
    store().setTableShape('t1', TableShape.RECT);
    const payload = store().buildSavePayload();
    expect(payload.layout.tables.find((t) => t.id === 't1')!.shape).toBe('RECT');
  });
});
