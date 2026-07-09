import { purchaseToBase, baseToPurchasePacks } from './uom.util';

describe('unit-of-measure conversion', () => {
  it('converts purchase units to base units (BOX of 12 → 24 PCS)', () => {
    expect(purchaseToBase(2, 12)).toBe(24);
  });

  it('rounds base need UP to whole purchase packs', () => {
    // need 18 PCS, a BOX is 12 → 2 boxes (24 PCS)
    expect(baseToPurchasePacks(18, 12)).toBe(2);
    expect(baseToPurchasePacks(24, 12)).toBe(2);
    expect(baseToPurchasePacks(25, 12)).toBe(3);
  });

  it('treats a null/zero/1 factor as "no packaging" (1:1)', () => {
    expect(purchaseToBase(5, null)).toBe(5);
    expect(purchaseToBase(5, 0)).toBe(5);
    expect(baseToPurchasePacks(5, 1)).toBe(5);
    expect(baseToPurchasePacks(5, null)).toBe(5);
  });
});
