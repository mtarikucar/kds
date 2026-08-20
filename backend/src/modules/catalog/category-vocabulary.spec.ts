import {
  HARDWARE_CATEGORIES,
  CATEGORY_VALUES,
} from './category-vocabulary';
import { CATEGORY_DEFAULT_SALE_MODE } from './dto/create-hardware-product.dto';

/**
 * Spec for the single-source category vocabulary. CATEGORY_VALUES must be the
 * exact value list derived from HARDWARE_CATEGORIES (the DTO @IsIn gate and the
 * SPA both depend on this projection), values must be unique, and the known
 * regulatory-tier categories must be present.
 */
describe('category-vocabulary', () => {
  it('derives CATEGORY_VALUES as the projection of HARDWARE_CATEGORIES.value', () => {
    expect(CATEGORY_VALUES).toEqual(HARDWARE_CATEGORIES.map((c) => c.value));
    expect(CATEGORY_VALUES.length).toBe(HARDWARE_CATEGORIES.length);
  });

  it('has unique category values (no @IsIn ambiguity)', () => {
    expect(new Set(CATEGORY_VALUES).size).toBe(CATEGORY_VALUES.length);
  });

  it('every category carries a non-empty value and TR label', () => {
    for (const c of HARDWARE_CATEGORIES) {
      expect(typeof c.value).toBe('string');
      expect(c.value.length).toBeGreaterThan(0);
      expect(typeof c.labelTr).toBe('string');
      expect(c.labelTr.length).toBeGreaterThan(0);
    }
  });

  it('includes the regulated-tier categories used by CATEGORY_DEFAULT_SALE_MODE', () => {
    expect(CATEGORY_VALUES).toEqual(
      expect.arrayContaining(['yazarkasa', 'pos_terminal', 'service']),
    );
  });

  it('carries the card-reader category AND its saleMode default', () => {
    // Two lists, one concept. The vocabulary decides what the @IsIn gate and
    // the storefront filter accept; CATEGORY_DEFAULT_SALE_MODE decides the
    // regulatory tier applied when an admin omits saleMode. A value present in
    // one and missing from the other publishes a product with an undefined
    // tier — which the DIRECT_SALE publish gate then fails, silently, at
    // create time.
    expect(CATEGORY_VALUES).toContain('card_reader');
    expect(CATEGORY_DEFAULT_SALE_MODE['card_reader']).toBe('DIRECT_SALE');
  });

  it('gives every vocabulary value a default sale mode', () => {
    // The general form of the bug above, so the next category cannot repeat it.
    const missing = CATEGORY_VALUES.filter(
      (v) => !(v in CATEGORY_DEFAULT_SALE_MODE),
    );
    expect(missing).toEqual([]);
  });
});
