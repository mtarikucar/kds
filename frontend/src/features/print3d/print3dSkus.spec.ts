import { describe, it, expect } from 'vitest';
import {
  PRINT3D_BASE_SKU,
  PRINT3D_ITEM_SKU,
  computePrint3dTotalCents,
  isPrint3dSku,
} from './print3dSkus';

describe('print3dSkus', () => {
  it('isPrint3dSku matches both SKUs and nothing else', () => {
    expect(isPrint3dSku(PRINT3D_BASE_SKU)).toBe(true);
    expect(isPrint3dSku(PRINT3D_ITEM_SKU)).toBe(true);
    expect(isPrint3dSku('install-yazarkasa-gib')).toBe(false);
    expect(isPrint3dSku('print3d')).toBe(false);
    expect(isPrint3dSku(undefined)).toBe(false);
    expect(isPrint3dSku(null)).toBe(false);
  });

  it('computePrint3dTotalCents returns 150000 + 5000*n', () => {
    expect(computePrint3dTotalCents(1, 150_000, 5_000)).toBe(155_000);
    expect(computePrint3dTotalCents(10, 150_000, 5_000)).toBe(200_000);
    expect(computePrint3dTotalCents(50, 150_000, 5_000)).toBe(400_000);
  });

  it('computePrint3dTotalCents never goes below the base for a zero selection', () => {
    expect(computePrint3dTotalCents(0, 150_000, 5_000)).toBe(150_000);
  });
});
