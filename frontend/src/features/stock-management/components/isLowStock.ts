import type { StockItem } from '../types';

/**
 * Row-level low-stock predicate extracted verbatim from StockItemsTab so
 * the threshold rule is unit-testable in isolation. A stock item is "low"
 * when its current quantity is at or below its configured minimum. Values
 * are coerced with Number(...) to match the API contract where numeric
 * fields can arrive as strings.
 */
export function isLowStock(item: Pick<StockItem, 'currentStock' | 'minStock'>): boolean {
  return Number(item.currentStock) <= Number(item.minStock);
}
