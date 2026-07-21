import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { FLOOR_SPRITES, spriteForElementType, type FloorSpriteKey } from './sprites';
import { FloorElementType } from '../../types';

// Guards against manifest/asset drift (clone of marketing/data/images.test.ts):
// every non-null sprite entry must point under /floor-sprites/ and its PNG must
// exist on disk — filenames are immutable (nginx 1y cache), so a broken entry
// would silently strand clients on the vector fallback.
describe('floor sprite manifest', () => {
  const keys = Object.keys(FLOOR_SPRITES) as FloorSpriteKey[];

  it('covers all 8 sprite keys', () => {
    expect(keys).toHaveLength(8);
  });

  it.each(keys)('%s: non-null src lives under /floor-sprites/ and exists on disk', (key) => {
    const src = FLOOR_SPRITES[key];
    if (src === null) return; // asset not generated yet → vector fallback
    expect(src.startsWith('/floor-sprites/'), `${key} src outside /floor-sprites/`).toBe(true);
    expect(existsSync(path.join(process.cwd(), 'public', src)), `${key} asset missing`).toBe(true);
  });

  it('structural/stretchable element types never get a sprite', () => {
    expect(spriteForElementType(FloorElementType.WALL)).toBeNull();
    expect(spriteForElementType(FloorElementType.RECT)).toBeNull();
    expect(spriteForElementType(FloorElementType.TEXT)).toBeNull();
  });
});
