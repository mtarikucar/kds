import { describe, it, expect } from 'vitest';
import { createCategorySchema, createProductSchema } from './menuSchemas';

// Identity translator: keep the validation-key as the message so assertions
// can pin the exact failing rule without depending on i18n bundles.
const t = (key: string) => key;

describe('createCategorySchema', () => {
  const schema = createCategorySchema(t);

  it('accepts a category with a non-empty name', () => {
    const result = schema.safeParse({ name: 'Drinks' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty name and reports nameRequired', () => {
    const result = schema.safeParse({ name: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const nameErr = result.error.issues.find((i) => i.path[0] === 'name');
      expect(nameErr?.message).toBe('menu.validation.nameRequired');
    }
  });

  it('allows optional description and displayOrder to be omitted', () => {
    const result = schema.safeParse({ name: 'Mains', displayOrder: 3 });
    expect(result.success).toBe(true);
  });
});

describe('createProductSchema', () => {
  const schema = createProductSchema(t);

  const valid = {
    name: 'Burger',
    price: 9.5,
    categoryId: 'cat-1',
  };

  it('accepts a valid product', () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it('rejects an empty name and reports nameRequired', () => {
    const result = schema.safeParse({ ...valid, name: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.issues.find((i) => i.path[0] === 'name');
      expect(err?.message).toBe('menu.validation.nameRequired');
    }
  });

  it('rejects a negative price and reports pricePositive', () => {
    const result = schema.safeParse({ ...valid, price: -1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.issues.find((i) => i.path[0] === 'price');
      expect(err?.message).toBe('menu.validation.pricePositive');
    }
  });

  it('accepts a zero price (price >= 0 boundary)', () => {
    expect(schema.safeParse({ ...valid, price: 0 }).success).toBe(true);
  });

  it('requires a categoryId and reports categoryRequired when blank', () => {
    const result = schema.safeParse({ ...valid, categoryId: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.issues.find((i) => i.path[0] === 'categoryId');
      expect(err?.message).toBe('menu.validation.categoryRequired');
    }
  });

  it('rejects a negative currentStock and reports stockPositive', () => {
    const result = schema.safeParse({ ...valid, currentStock: -5 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.issues.find((i) => i.path[0] === 'currentStock');
      expect(err?.message).toBe('menu.validation.stockPositive');
    }
  });

  it('rejects a malformed image url and reports invalidUrl', () => {
    const result = schema.safeParse({ ...valid, image: 'not-a-url' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.issues.find((i) => i.path[0] === 'image');
      expect(err?.message).toBe('menu.validation.invalidUrl');
    }
  });

  it('accepts an empty-string image (the .or(literal("")) escape hatch)', () => {
    expect(schema.safeParse({ ...valid, image: '' }).success).toBe(true);
  });
});
