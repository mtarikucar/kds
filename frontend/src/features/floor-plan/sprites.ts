import { FloorElementType, TableShape } from '../../types';

/**
 * System-wide pixel-art sprite set for the floor plan — ONE asset set for the
 * whole product, committed under frontend/public. Filenames are immutable
 * (nginx caches .png for 1y immutable), so a content change must bump the
 * version dir (v1 → v2), never overwrite a file in place.
 *
 * NOTE: constants.ts imports from this file — keep this module free of
 * imports from constants.ts to avoid a cycle.
 */
export type FloorSpriteKey =
  | 'table-round'
  | 'table-square'
  | 'table-rect'
  | 'plant'
  | 'bar'
  | 'kitchen'
  | 'door'
  | 'decor';

export const SPRITE_BASE = '/floor-sprites/v1';

/**
 * null = asset not generated/curated yet → renderers keep the vector look.
 * Once an asset lands in public/floor-sprites/v1, flip its entry to
 * `${SPRITE_BASE}/<key>.png` (existence is guarded by sprites.test.ts).
 */
export const FLOOR_SPRITES: Record<FloorSpriteKey, string | null> = {
  'table-round': null,
  'table-square': null,
  'table-rect': null,
  plant: null,
  bar: null,
  kitchen: null,
  door: null,
  decor: null,
};

const ELEMENT_SPRITE_KEY: Partial<Record<FloorElementType, FloorSpriteKey>> = {
  [FloorElementType.PLANT]: 'plant',
  [FloorElementType.BAR]: 'bar',
  [FloorElementType.KITCHEN]: 'kitchen',
  [FloorElementType.DOOR]: 'door',
  [FloorElementType.DECOR]: 'decor',
};

/** WALL/RECT/TEXT are structural/stretchable → always vector (null). */
export function spriteForElementType(type: FloorElementType): string | null {
  const key = ELEMENT_SPRITE_KEY[type];
  return key ? FLOOR_SPRITES[key] : null;
}

const SHAPE_SPRITE_KEY: Record<TableShape, FloorSpriteKey> = {
  [TableShape.ROUND]: 'table-round',
  [TableShape.SQUARE]: 'table-square',
  [TableShape.RECT]: 'table-rect',
};

export function spriteForTableShape(shape: TableShape): string | null {
  const key = SHAPE_SPRITE_KEY[shape];
  return key ? FLOOR_SPRITES[key] : null;
}
