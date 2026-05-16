import { Prisma } from '@prisma/client';
import { splitGrossAmount, DEFAULT_KDV_RATE } from './kdv.helper';

describe('splitGrossAmount (KDV)', () => {
  it('uses 20% as the default Turkish KDV rate', () => {
    expect(DEFAULT_KDV_RATE).toBe(0.2);
  });

  it('splits 1000 gross into 833.33 + 166.67 = 1000', () => {
    const r = splitGrossAmount(1000);
    expect(r.subtotal.toString()).toBe('833.33');
    expect(r.tax.toString()).toBe('166.67');
    expect(r.total.toString()).toBe('1000');
  });

  it('splits 299.99 gross into 249.99 + 50.00 = 299.99', () => {
    const r = splitGrossAmount('299.99');
    expect(r.subtotal.toString()).toBe('249.99');
    expect(r.tax.toString()).toBe('50');
    expect(r.total.toString()).toBe('299.99');
  });

  it('handles 1.00 (rounding edge): 0.83 + 0.17 = 1.00', () => {
    const r = splitGrossAmount(1);
    expect(r.subtotal.toString()).toBe('0.83');
    expect(r.tax.toString()).toBe('0.17');
    expect(r.total.toString()).toBe('1');
  });

  it('handles zero gross', () => {
    const r = splitGrossAmount(0);
    expect(r.subtotal.toString()).toBe('0');
    expect(r.tax.toString()).toBe('0');
    expect(r.total.toString()).toBe('0');
  });

  it('subtotal + tax always equals total (no float drift)', () => {
    const inputs = [123.45, 0.01, 0.99, 1.2, 7777.77, 19999.99];
    for (const v of inputs) {
      const r = splitGrossAmount(v);
      expect(r.subtotal.add(r.tax).toString()).toBe(r.total.toString());
    }
  });

  it('accepts Prisma.Decimal input', () => {
    const r = splitGrossAmount(new Prisma.Decimal('500.00'));
    expect(r.subtotal.toString()).toBe('416.67');
    expect(r.tax.toString()).toBe('83.33');
    expect(r.total.toString()).toBe('500');
  });

  it('supports a custom rate (10% KDV reduced)', () => {
    // 110 gross at 10% rate → subtotal 100, tax 10.
    const r = splitGrossAmount(110, 0.1);
    expect(r.subtotal.toString()).toBe('100');
    expect(r.tax.toString()).toBe('10');
    expect(r.total.toString()).toBe('110');
  });
});
