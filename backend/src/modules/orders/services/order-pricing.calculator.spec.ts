import { Prisma } from '@prisma/client';
import { OrderPricingCalculator } from './order-pricing.calculator';
import { TaxCalculationService } from '../../accounting/services/tax-calculation.service';

/**
 * Unit spec for the pure pricing calculator extracted from OrdersService
 * (wave-d2 split). Mirrors the inlined math byte-for-byte; the end-to-end
 * behaviour is additionally pinned by orders.service.pricing.spec.ts.
 */
describe('OrderPricingCalculator', () => {
  const calc = new OrderPricingCalculator();
  const tax = new TaxCalculationService();

  const productMap = new Map<string, { price: unknown; taxRate?: number | null }>([
    ['p-A', { price: new Prisma.Decimal('30.00'), taxRate: 18 }],
    ['p-B', { price: new Prisma.Decimal('10.50'), taxRate: 8 }],
    ['p-noTax', { price: new Prisma.Decimal('12.00'), taxRate: null }], // → default 10
  ]);
  const modifierMap = new Map<string, { priceAdjustment: unknown }>([
    ['m-X', { priceAdjustment: new Prisma.Decimal('5.00') }],
  ]);

  it('computes subtotal, modifierTotal, unitPrice, taxRate and per-line tax', () => {
    const res = calc.priceItems(
      [
        { productId: 'p-A', quantity: 2, modifiers: [{ modifierId: 'm-X', quantity: 1 }], notes: 'no onion' },
        { productId: 'p-B', quantity: 3 },
      ],
      productMap,
      modifierMap,
      tax,
    );

    expect(res.orderItems[0]).toEqual({
      productId: 'p-A',
      quantity: 2,
      unitPrice: 30,
      subtotal: 70, // 2 * (30 + 5)
      modifierTotal: 5,
      taxRate: 18,
      taxAmount: tax.extractTax(70, 18).taxAmount,
      notes: 'no onion',
      modifiers: { create: [{ modifierId: 'm-X', quantity: 1, priceAdjustment: 5 }] },
    });
    expect(res.orderItems[1].subtotal).toBe(31.5);
    expect(res.orderItems[1].modifiers).toBeUndefined();
    expect(res.totalAmount).toBe(101.5);
    expect(res.totalTaxAmount).toBe(
      tax.extractTax(70, 18).taxAmount + tax.extractTax(31.5, 8).taxAmount,
    );
  });

  it('defaults taxRate to 10 when the product taxRate is null', () => {
    const res = calc.priceItems(
      [{ productId: 'p-noTax', quantity: 1 }],
      productMap,
      modifierMap,
      tax,
    );
    expect(res.orderItems[0].taxRate).toBe(10);
    expect(res.orderItems[0].taxAmount).toBe(tax.extractTax(12, 10).taxAmount);
  });

  it('leaves taxAmount/totalTaxAmount at 0 when no tax service is supplied', () => {
    const res = calc.priceItems(
      [{ productId: 'p-A', quantity: 1 }],
      productMap,
      modifierMap,
      undefined,
    );
    expect(res.orderItems[0].taxAmount).toBe(0);
    expect(res.totalTaxAmount).toBe(0);
    expect(res.totalAmount).toBe(30);
  });

  it('treats unknown product/modifier ids as price 0 (Number coercion of nullish)', () => {
    const res = calc.priceItems(
      [{ productId: 'missing', quantity: 4, modifiers: [{ modifierId: 'missing-mod', quantity: 2 }] }],
      productMap,
      modifierMap,
      tax,
    );
    expect(res.orderItems[0].unitPrice).toBe(0);
    expect(res.orderItems[0].modifierTotal).toBe(0);
    expect(res.orderItems[0].subtotal).toBe(0);
    expect(res.orderItems[0].taxRate).toBe(10); // missing product → default
  });
});
