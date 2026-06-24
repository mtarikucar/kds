import { BadRequestException } from '@nestjs/common';
import {
  validateModifierSelections,
  ModifierSelectionProduct,
} from './modifier-selection.validator';

/**
 * Unit spec for the shared ModifierGroup required/min/max enforcement that
 * BOTH the staff POS path (OrdersService) and the customer QR path
 * (CustomerOrdersService) rely on. M7: the staff path used to skip these.
 */
describe('validateModifierSelections', () => {
  const requiredSingle = (overrides: Partial<any> = {}) =>
    ({
      name: 'Steak',
      modifierGroups: [
        {
          group: {
            isActive: true,
            isRequired: true,
            minSelections: 0,
            maxSelections: 1,
            displayName: 'Cooking Temperature',
            modifiers: [{ id: 'rare' }, { id: 'medium' }, { id: 'well' }],
            ...overrides,
          },
        },
      ],
    }) as ModifierSelectionProduct;

  it('passes when a required group has a valid single selection', () => {
    expect(() =>
      validateModifierSelections(requiredSingle(), ['medium']),
    ).not.toThrow();
  });

  it('throws when a required group is omitted entirely', () => {
    expect(() => validateModifierSelections(requiredSingle(), [])).toThrow(
      BadRequestException,
    );
  });

  it('throws when maxSelections is exceeded', () => {
    expect(() =>
      validateModifierSelections(requiredSingle(), ['rare', 'medium']),
    ).toThrow(/at most 1 selection/);
  });

  it('treats maxSelections null as unbounded', () => {
    const p = requiredSingle({
      isRequired: false,
      maxSelections: null,
    });
    expect(() =>
      validateModifierSelections(p, ['rare', 'medium', 'well']),
    ).not.toThrow();
  });

  it('treats maxSelections <= 0 as unbounded', () => {
    const p = requiredSingle({ isRequired: false, maxSelections: 0 });
    expect(() =>
      validateModifierSelections(p, ['rare', 'medium', 'well']),
    ).not.toThrow();
  });

  it('enforces minSelections even when not isRequired', () => {
    const p = requiredSingle({
      isRequired: false,
      minSelections: 2,
      maxSelections: null,
    });
    expect(() => validateModifierSelections(p, ['rare'])).toThrow(
      /at least 2 selection/,
    );
    expect(() =>
      validateModifierSelections(p, ['rare', 'medium']),
    ).not.toThrow();
  });

  it('rejects a modifier that does not belong to any active group on the product', () => {
    expect(() =>
      validateModifierSelections(requiredSingle(), ['foreign-mod']),
    ).toThrow(/not allowed on product/);
  });

  it('ignores inactive groups for both belongs-to-product and required checks', () => {
    const p = requiredSingle({ isActive: false });
    // inactive required group → not enforced, and its modifiers are NOT allowed
    expect(() => validateModifierSelections(p, [])).not.toThrow();
    expect(() => validateModifierSelections(p, ['rare'])).toThrow(
      BadRequestException,
    );
  });

  it('treats a product with no modifierGroups as unconstrained', () => {
    const p = { name: 'Plain', modifierGroups: [] } as ModifierSelectionProduct;
    expect(() => validateModifierSelections(p, [])).not.toThrow();
    const undef = { name: 'Plain' } as ModifierSelectionProduct;
    expect(() => validateModifierSelections(undef, [])).not.toThrow();
  });
});
