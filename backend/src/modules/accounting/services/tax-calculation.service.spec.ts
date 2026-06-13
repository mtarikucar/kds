import { TaxCalculationService } from './tax-calculation.service';

/**
 * Behavioural tests for the tax math. There is no DB here — this service is
 * pure Decimal arithmetic, and that arithmetic is the compliance-sensitive
 * part (KDV extraction from tax-inclusive prices). Turkish products are
 * stored KDV-DAHİL (price includes tax), so the service must back out the
 * tax component rather than add it on top.
 *
 * The invariant under test everywhere: subtotalExcTax + taxAmount === priceIncTax
 * (to 2dp), and per-rate breakdowns sum to the order totals.
 */
describe('TaxCalculationService.extractTax', () => {
  let svc: TaxCalculationService;
  beforeEach(() => {
    svc = new TaxCalculationService();
  });

  it('backs the tax OUT of an inclusive price (KDV dahil), not on top', () => {
    // 120.00 inclusive @ 20% → base 100.00, tax 20.00. A naive
    // add-on-top would have produced 144.00 / tax 24.00.
    const out = svc.extractTax(120, 20);
    expect(out.subtotalExcludingTax).toBe(100);
    expect(out.taxAmount).toBe(20);
    expect(out.totalIncludingTax).toBe(120);
    expect(out.taxRate).toBe(20);
  });

  it('keeps base + tax === inclusive total at 2dp on a non-round price', () => {
    // 99.99 inclusive @ 10% → base 90.90, tax 9.09 (rounded HALF_UP).
    const out = svc.extractTax(99.99, 10);
    expect(out.subtotalExcludingTax).toBe(90.9);
    expect(out.taxAmount).toBe(9.09);
    expect(
      Math.round((out.subtotalExcludingTax + out.taxAmount) * 100) / 100,
    ).toBe(99.99);
  });

  it('treats a 0% rate as all-base, zero-tax', () => {
    const out = svc.extractTax(50, 0);
    expect(out.subtotalExcludingTax).toBe(50);
    expect(out.taxAmount).toBe(0);
  });

  it('accepts string/Decimal-ish money inputs without float drift', () => {
    const out = svc.extractTax('120', 20);
    expect(out.subtotalExcludingTax).toBe(100);
    expect(out.taxAmount).toBe(20);
  });
});

describe('TaxCalculationService.calculateOrderTax', () => {
  let svc: TaxCalculationService;
  beforeEach(() => {
    svc = new TaxCalculationService();
  });

  it('multiplies by quantity and adds modifiers BEFORE extracting tax', () => {
    // (100 base price + 20 modifier) * 2 qty = 240 inclusive @ 20%
    // → base 200, tax 40.
    const out = svc.calculateOrderTax([
      {
        productId: 'p1',
        quantity: 2,
        unitPriceIncTax: 100,
        modifierTotalIncTax: 20,
        taxRate: 20,
      },
    ]);
    expect(out.totalIncTax).toBe(240);
    expect(out.totalExcTax).toBe(200);
    expect(out.totalTax).toBe(40);

    const item = out.items[0];
    expect(item.subtotalIncTax).toBe(240);
    expect(item.taxAmount).toBe(40);
    // unitPriceExcTax is the bare unit price (no modifier, no qty): 100/1.2
    expect(item.unitPriceExcTax).toBe(83.33);
  });

  it('groups multiple lines of the SAME rate into one breakdown bucket', () => {
    const out = svc.calculateOrderTax([
      {
        productId: 'a',
        quantity: 1,
        unitPriceIncTax: 120,
        modifierTotalIncTax: 0,
        taxRate: 20,
      },
      {
        productId: 'b',
        quantity: 1,
        unitPriceIncTax: 240,
        modifierTotalIncTax: 0,
        taxRate: 20,
      },
    ]);
    expect(Object.keys(out.taxBreakdown)).toEqual(['20']);
    expect(out.taxBreakdown[20].taxAmount).toBe(60); // 20 + 40
    expect(out.taxBreakdown[20].taxableAmount).toBe(300); // 100 + 200
  });

  it('keeps separate breakdown buckets per distinct rate and they sum to totals', () => {
    const out = svc.calculateOrderTax([
      {
        productId: 'food',
        quantity: 1,
        unitPriceIncTax: 110,
        modifierTotalIncTax: 0,
        taxRate: 10,
      },
      {
        productId: 'drink',
        quantity: 1,
        unitPriceIncTax: 120,
        modifierTotalIncTax: 0,
        taxRate: 20,
      },
    ]);
    expect(out.taxBreakdown[10].taxAmount).toBe(10);
    expect(out.taxBreakdown[20].taxAmount).toBe(20);
    // per-rate buckets must reconcile to the order totals
    const sumBucketTax =
      out.taxBreakdown[10].taxAmount + out.taxBreakdown[20].taxAmount;
    expect(sumBucketTax).toBe(out.totalTax);
    expect(out.totalTax).toBe(30);
    expect(out.totalIncTax).toBe(230);
    expect(out.totalExcTax).toBe(200);
  });

  it('returns zeroed totals and an empty breakdown for an empty order', () => {
    const out = svc.calculateOrderTax([]);
    expect(out.items).toEqual([]);
    expect(out.taxBreakdown).toEqual({});
    expect(out.totalExcTax).toBe(0);
    expect(out.totalTax).toBe(0);
    expect(out.totalIncTax).toBe(0);
  });
});
