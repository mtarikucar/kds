import { describe, it, expect } from 'vitest';
import { isLowStock } from './isLowStock';

/**
 * Unit spec for the extracted StockItemsTab row predicate (was inline in
 * the table map). Low = current at or below minimum, with Number(...)
 * coercion so string-typed API values still compare numerically.
 */
describe('isLowStock', () => {
  it('is low when current is strictly below minimum', () => {
    expect(isLowStock({ currentStock: 3, minStock: 5 })).toBe(true);
  });

  it('is low at exactly the minimum (inclusive boundary)', () => {
    expect(isLowStock({ currentStock: 5, minStock: 5 })).toBe(true);
  });

  it('is not low when current is above minimum', () => {
    expect(isLowStock({ currentStock: 6, minStock: 5 })).toBe(false);
  });

  it('coerces string-typed numeric fields before comparing', () => {
    // API may hand back decimals as strings; the comparison must be numeric
    // (not lexicographic) — '10' < '9' lexically but 10 > 9 numerically.
    expect(isLowStock({ currentStock: '10' as unknown as number, minStock: '9' as unknown as number })).toBe(false);
    expect(isLowStock({ currentStock: '2' as unknown as number, minStock: '9' as unknown as number })).toBe(true);
  });
});
