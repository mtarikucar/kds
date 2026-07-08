import { ReorderSuggestionService } from './reorder-suggestion.service';

/**
 * Reorder suggestions: items at/below their par (minStock) become suggested
 * order lines, grouped into a draft PO per preferred supplier. Suggested qty is
 * the explicit reorderQuantity, else a derived default that brings stock back
 * toward twice the par level. Items with no supplier land in `unassigned`.
 */
describe('ReorderSuggestionService', () => {
  const SCOPE = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'ADMIN' } as const;
  let prisma: any;
  let svc: ReorderSuggestionService;

  beforeEach(() => {
    prisma = { stockItem: { findMany: jest.fn() } };
    svc = new ReorderSuggestionService(prisma);
  });

  it('groups below-par items into a draft PO per preferred supplier and derives qty', async () => {
    prisma.stockItem.findMany.mockResolvedValue([
      {
        id: 'A', name: 'Flour', unit: 'KG', currentStock: 2, minStock: 10, costPerUnit: 3, reorderQuantity: null,
        supplierStockItems: [
          { isPreferred: false, unitPrice: 9, supplierSku: null, supplier: { id: 'S2', name: 'Alt' } },
          { isPreferred: true, unitPrice: 2.5, supplierSku: 'F-1', supplier: { id: 'S1', name: 'Main' } },
        ],
      },
      {
        id: 'B', name: 'Sugar', unit: 'KG', currentStock: 5, minStock: 5, costPerUnit: 4, reorderQuantity: 30,
        supplierStockItems: [
          { isPreferred: false, unitPrice: 4, supplierSku: null, supplier: { id: 'S1', name: 'Main' } },
        ],
      },
      // Above par → excluded by the JS filter.
      {
        id: 'C', name: 'Salt', unit: 'KG', currentStock: 100, minStock: 10, costPerUnit: 1, reorderQuantity: null,
        supplierStockItems: [],
      },
      // Below par, no supplier → unassigned, priced at costPerUnit.
      {
        id: 'D', name: 'Yeast', unit: 'G', currentStock: 1, minStock: 5, costPerUnit: 2, reorderQuantity: null,
        supplierStockItems: [],
      },
    ]);

    const res = await svc.getSuggestions(SCOPE);

    expect(res.totalItemsBelowPar).toBe(3); // A, B, D (C excluded)
    // One draft order for supplier S1 (A preferred + B only-supplier)
    expect(res.draftOrders).toHaveLength(1);
    const s1 = res.draftOrders[0];
    expect(s1.supplierId).toBe('S1');
    expect(s1.items.map((i: any) => i.stockItemId).sort()).toEqual(['A', 'B']);
    // A: derived qty = max(2*par - cur, par) = max(20-2,10)=18 @ 2.5 = 45
    const a = s1.items.find((i: any) => i.stockItemId === 'A');
    expect(a.suggestedQty).toBe(18);
    expect(a.unitPrice).toBe(2.5); // preferred supplier price, not costPerUnit
    expect(a.estimatedCost).toBe(45);
    // B: explicit reorderQuantity 30 @ 4 = 120
    const b = s1.items.find((i: any) => i.stockItemId === 'B');
    expect(b.suggestedQty).toBe(30);
    expect(b.estimatedCost).toBe(120);
    expect(s1.estimatedTotal).toBe(165);
    // D has no supplier
    expect(res.unassigned).toHaveLength(1);
    expect(res.unassigned[0].stockItemId).toBe('D');
    expect(res.unassigned[0].unitPrice).toBe(2); // falls back to costPerUnit
  });

  it('returns empty when nothing is below par', async () => {
    prisma.stockItem.findMany.mockResolvedValue([
      { id: 'X', name: 'X', unit: 'KG', currentStock: 50, minStock: 10, costPerUnit: 1, reorderQuantity: null, supplierStockItems: [] },
    ]);
    const res = await svc.getSuggestions(SCOPE);
    expect(res.totalItemsBelowPar).toBe(0);
    expect(res.draftOrders).toHaveLength(0);
  });
});
