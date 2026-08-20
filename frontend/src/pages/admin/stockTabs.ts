export type StockTab = 'items' | 'orders' | 'suppliers' | 'costing' | 'operations';

// Order defines the tab row; 'items' is the landing tab.
export const STOCK_TABS: StockTab[] = ['items', 'orders', 'suppliers', 'costing', 'operations'];

export const isStockTab = (v: string): v is StockTab => (STOCK_TABS as string[]).includes(v);

// Retired tabs and where their content went. 'guide' (Tedarik Rehberi) was
// folded into the suppliers hub — its buy list now opens that page and its
// channel guide closes it. Kept as a redirect so existing bookmarks and links
// land on the content instead of silently falling through to the default tab.
const RETIRED_TABS: Record<string, StockTab> = { guide: 'suppliers' };

export const parseStockTab = (raw: string | null): StockTab => {
  if (!raw) return 'items';
  if (isStockTab(raw)) return raw;
  return RETIRED_TABS[raw] ?? 'items';
};
