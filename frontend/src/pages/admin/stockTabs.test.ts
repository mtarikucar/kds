import { describe, it, expect } from 'vitest';
import { parseStockTab, STOCK_TABS, isStockTab } from './stockTabs';

describe('stockTabs', () => {
  it('lists 6 tabs with guide first', () => {
    expect(STOCK_TABS).toEqual(['guide', 'items', 'orders', 'suppliers', 'costing', 'operations']);
  });
  it('parses a known tab', () => {
    expect(parseStockTab('orders')).toBe('orders');
  });
  it('defaults unknown/null to guide', () => {
    expect(parseStockTab(null)).toBe('guide');
    expect(parseStockTab('bogus')).toBe('guide');
    expect(parseStockTab('')).toBe('guide');
  });
  it('type-guards', () => {
    expect(isStockTab('items')).toBe(true);
    expect(isStockTab('nope')).toBe(false);
  });
});
