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

  it('buildSavePayload emits ONLY touched tables (untouched rows stay out of the fail-closed save)', () => {
    store().assignTableToZone('t2', 'z1', 200, 200); // touch t2 only
    const payload = store().buildSavePayload();
    expect(payload.layout.tables).toHaveLength(1);
    expect(payload.layout.tables[0]).toMatchObject({ id: 't2', zoneId: 'z1', posX: 200, posY: 200, shape: 'SQUARE' });
    // t1 was never touched → must not be in the payload
    expect(payload.layout.tables.find((t) => t.id === 't1')).toBeUndefined();
  });

  it('setTableShape updates the shape in the save payload', () => {
    store().setTableShape('t1', TableShape.RECT);
    const payload = store().buildSavePayload();
    expect(payload.layout.tables.find((t) => t.id === 't1')!.shape).toBe('RECT');
  });

  it('clamps + normalizes geometry to the backend bounds so a save can never 400', () => {
    // oversize width, off-canvas pos, flipped (negative) height, cumulative rotation
    store().transformTable('t1', { width: 9000, height: -50, posX: 99999, rotation: 725 });
    const t = store().tables.t1;
    expect(t.width).toBe(2000); // table max
    expect(t.height).toBe(50); // abs(-50), within [10,2000]
    expect(t.posX).toBe(12000); // coord max
    expect(t.rotation).toBe(5); // 725 % 360
    const payloadT = store().buildSavePayload().layout.tables.find((x) => x.id === 't1')!;
    expect(payloadT).toMatchObject({ width: 2000, height: 50, posX: 12000, rotation: 5 });
  });

  it('moveTable clamps a far-off-canvas drag into the coordinate range', () => {
    store().moveTable('t1', -50000, 80000, 0);
    expect(store().tables.t1.posX).toBe(-2000);
    expect(store().tables.t1.posY).toBe(12000);
  });

  it('applyCreated swaps temp ids for server ids, clears _new, and remaps selection', () => {
    const tempId = store().addElement(FloorElementType.DECOR, 'z1', { x: 10, y: 10, width: 80, height: 80 });
    expect(store().buildSavePayload().creates).toHaveLength(1);

    store().applyCreated({
      [tempId]: { id: 'srv-1', zoneId: 'z1', type: FloorElementType.DECOR, x: 10, y: 10, width: 80, height: 80, rotation: 0, points: null, style: null, label: null, zIndex: 0 },
    });

    expect(store().elements[tempId]).toBeUndefined();
    expect(store().elements['srv-1']).toBeDefined();
    expect((store().elements['srv-1'] as any)._new).toBeUndefined();
    expect(store().selection).toEqual([{ kind: 'element', id: 'srv-1' }]);
    // After reconcile there is no _new element → the next save won't re-create it
    expect(store().buildSavePayload().creates).toHaveLength(0);
  });

  it('undoing the only change clears dirty (back at the saved baseline)', () => {
    store().moveTable('t1', 300, 300, 20);
    expect(store().dirty).toBe(true);
    store().undo();
    expect(store().dirty).toBe(false);
  });

  it('markSavedClean clears the touched sets', () => {
    store().moveTable('t1', 200, 200, 20);
    expect(store().touchedTableIds.has('t1')).toBe(true);
    store().markSavedClean();
    expect(store().touchedTableIds.size).toBe(0);
    expect(store().buildSavePayload().layout.tables).toHaveLength(0);
  });
});
