export type StockTab = 'guide' | 'items' | 'orders' | 'suppliers' | 'costing' | 'operations';

// Order defines the tab row; 'guide' is the landing tab.
export const STOCK_TABS: StockTab[] = ['guide', 'items', 'orders', 'suppliers', 'costing', 'operations'];

export const isStockTab = (v: string): v is StockTab => (STOCK_TABS as string[]).includes(v);

export const parseStockTab = (raw: string | null): StockTab =>
  raw && isStockTab(raw) ? raw : 'guide';
