import {
  HARDWARE_CATEGORIES,
  CATEGORY_VALUES,
} from './category-vocabulary';

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
});
