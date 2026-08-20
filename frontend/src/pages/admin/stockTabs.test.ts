import { describe, it, expect } from 'vitest';
import { parseStockTab, STOCK_TABS, isStockTab } from './stockTabs';

describe('stockTabs', () => {
  it('lists 5 tabs with items first', () => {
    expect(STOCK_TABS).toEqual(['items', 'orders', 'suppliers', 'costing', 'operations']);
  });
  it('parses a known tab', () => {
    expect(parseStockTab('orders')).toBe('orders');
  });
  it('defaults unknown/null to items', () => {
    expect(parseStockTab(null)).toBe('items');
    expect(parseStockTab('bogus')).toBe('items');
    expect(parseStockTab('')).toBe('items');
  });
  it('redirects the retired guide tab to suppliers, where its content moved', () => {
    // A bookmark or an old link pointing at ?tab=guide must land on the
    // content, not silently on the default tab.
    expect(parseStockTab('guide')).toBe('suppliers');
  });
  it('type-guards', () => {
    expect(isStockTab('items')).toBe(true);
    expect(isStockTab('nope')).toBe(false);
    expect(isStockTab('guide')).toBe(false);
  });
});
