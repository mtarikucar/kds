import { FloorElementType, TableShape } from '../../types';
// Import direction is constants → sprites only (sprites.ts must stay cycle-free).
import type { FloorSpriteKey } from './sprites';

/** Default footprint for a newly-dropped table (design units). */
export const DEFAULT_TABLE_SIZE = { width: 80, height: 80 };

/** Default geometry per element type when dropped from the palette. */
export interface ElementPaletteItem {
  type: FloorElementType;
  labelKey: string;
  defaultWidth: number;
  defaultHeight: number;
  defaultStyle: Record<string, any>;
  /** Lucide icon name (resolved in the toolbar). */
  icon: string;
  /** Pixel-art sprite for this type (types without one stay vector). */
  spriteKey?: FloorSpriteKey;
}

export const ELEMENT_PALETTE: ElementPaletteItem[] = [
  {
    type: FloorElementType.WALL,
    labelKey: 'floorPlan:elements.wall',
    defaultWidth: 200,
    defaultHeight: 12,
    defaultStyle: { fill: '#475569' },
    icon: 'Minus',
  },
  {
    type: FloorElementType.DOOR,
    labelKey: 'floorPlan:elements.door',
    // Doors stay vector — the flat sliver is the clearest plan symbol.
    defaultWidth: 60,
    defaultHeight: 12,
    defaultStyle: { fill: '#a16207' },
    icon: 'DoorOpen',
  },
  {
    type: FloorElementType.BAR,
    labelKey: 'floorPlan:elements.bar',
    defaultWidth: 220,
    defaultHeight: 60,
    defaultStyle: { fill: '#1e293b' },
    icon: 'Wine',
    spriteKey: 'bar',
  },
  {
    type: FloorElementType.KITCHEN,
    labelKey: 'floorPlan:elements.kitchen',
    defaultWidth: 200,
    defaultHeight: 140,
    defaultStyle: { fill: '#334155' },
    icon: 'CookingPot',
    spriteKey: 'kitchen',
  },
  {
    type: FloorElementType.PLANT,
    labelKey: 'floorPlan:elements.plant',
    defaultWidth: 48,
    defaultHeight: 48,
    defaultStyle: { fill: '#15803d' },
    icon: 'Sprout',
    spriteKey: 'plant',
  },
  {
    type: FloorElementType.DECOR,
    labelKey: 'floorPlan:elements.decor',
    defaultWidth: 80,
    defaultHeight: 80,
    defaultStyle: { fill: '#7c3aed' },
    icon: 'Shapes',
    spriteKey: 'decor',
  },
  {
    type: FloorElementType.TEXT,
    labelKey: 'floorPlan:elements.text',
    defaultWidth: 140,
    defaultHeight: 32,
    defaultStyle: { color: '#0f172a', fontSize: 18 },
    icon: 'Type',
  },
  {
    type: FloorElementType.RECT,
    labelKey: 'floorPlan:elements.rect',
    defaultWidth: 120,
    defaultHeight: 80,
    defaultStyle: { fill: '#e2e8f0', stroke: '#94a3b8', strokeWidth: 2 },
    icon: 'Square',
  },
];

/** Table shapes offered in the editor + the palette. */
export const TABLE_SHAPES: { shape: TableShape; labelKey: string }[] = [
  { shape: TableShape.ROUND, labelKey: 'floorPlan:shapes.round' },
  { shape: TableShape.SQUARE, labelKey: 'floorPlan:shapes.square' },
  { shape: TableShape.RECT, labelKey: 'floorPlan:shapes.rect' },
];

export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 3;
export const ZOOM_STEP = 1.15;

/** The kind of thing currently selected / being placed in the editor. */
export type EditorTool = 'select' | FloorElementType | 'table';
