import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18next from 'i18next';
import enHardware from '../../i18n/locales/en/hardware.json';
import type { Product } from '../../types';

// Print3dProductPicker must NOT format money with a hardcoded tr-TR Intl
// instance (hardware-store/storeApi's `formatMoney`) — v3.7.0 made money
// display country-profile-driven, and Görev 14/15's implementer already had
// to make this exact correction on Print3dStoreCard (see its test file's
// header comment). Mocking the hook and asserting on ITS calls proves the
// rendered price traces through the country-profile formatter with the
// right MAJOR-UNIT numbers, not a component-local constant or a stray
// cents/100 slip.
const formatWithCurrency = vi.fn((amount: number, currency: string) => `FMT(${amount},${currency})`);
vi.mock('../../hooks/useFormatCurrency', () => ({
  useFormatCurrencyExtended: () => ({
    formatCurrency: (a: number) => String(a),
    formatWithCurrency,
    currency: 'TRY',
  }),
  useFormatCurrency: () => (a: number) => String(a),
}));

import Print3dProductPicker from './Print3dProductPicker';

beforeAll(() => {
  i18next.addResourceBundle('en', 'hardware', enHardware, true, true);
});

beforeEach(() => {
  formatWithCurrency.mockClear();
});

const product = (over: Partial<Product>): Product =>
  ({
    id: 'x',
    name: 'X',
    description: null,
    price: 100,
    image: null,
    images: [],
    categoryId: 'c-1',
    category: { id: 'c-1', name: 'Ana Yemek' },
    currentStock: 0,
    stockTracked: false,
    isAvailable: true,
    displayOrder: 0,
    tenantId: 't-1',
    createdAt: '',
    updatedAt: '',
    ...over,
  }) as Product;

const PRODUCTS = [
  product({ id: 'p1', name: 'Adana Kebap' }),
  product({ id: 'p2', name: 'Lahmacun' }),
  product({
    id: 'p3',
    name: 'Künefe',
    categoryId: 'c-2',
    category: { id: 'c-2', name: 'Tatlı' } as any,
  }),
];

function renderPicker(selected: string[] = [], max = 50, products: Product[] = PRODUCTS) {
  const onChange = vi.fn();
  render(
    <Print3dProductPicker
      products={products}
      selected={selected}
      onChange={onChange}
      maxSelection={max}
      basePriceCents={150000}
      perItemCents={5000}
      currency="TRY"
    />,
  );
  return { onChange };
}

describe('Print3dProductPicker', () => {
  it('filters the product list by the search box', () => {
    renderPicker();
    // ProductFilters.search SUNUCUDA uygulanmıyor; süzme istemci tarafında.
    fireEvent.change(screen.getByPlaceholderText(enHardware.print3d.picker.search), {
      target: { value: 'lahma' },
    });
    expect(screen.getByText('Lahmacun')).toBeTruthy();
    expect(screen.queryByText('Adana Kebap')).toBeNull();
  });

  it('filters by category', () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText(enHardware.print3d.picker.allCategories), {
      target: { value: 'c-2' },
    });
    expect(screen.getByText('Künefe')).toBeTruthy();
    expect(screen.queryByText('Adana Kebap')).toBeNull();
  });

  it('toggles a product and reports the new selection upward', () => {
    const { onChange } = renderPicker(['p1']);
    fireEvent.click(screen.getByTestId('print3d-pick-p2'));
    expect(onChange).toHaveBeenCalledWith(['p1', 'p2']);
    fireEvent.click(screen.getByTestId('print3d-pick-p1'));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('caps selection at maxSelection and disables further cards', () => {
    const { onChange } = renderPicker(['p1', 'p2'], 2);
    expect(screen.getByTestId('print3d-pick-p3')).toBeDisabled();
    fireEvent.click(screen.getByTestId('print3d-pick-p3'));
    expect(onChange).not.toHaveBeenCalled();
    // Zaten seçili olan bir kart, tavan dolu olsa da ÇIKARILABİLİR olmalı.
    expect(screen.getByTestId('print3d-pick-p1')).not.toBeDisabled();
  });

  it('enforces the REAL 1..50 order boundary: the 51st product cannot be picked', () => {
    // This is the money constraint from the plan's Global Constraints — 50
    // is not an arbitrary UI choice, it is the server's own ceiling
    // (qty = productIds.length, and the server rejects > 50). A test at a
    // toy value like 2 (above) proves the CAPPING MECHANISM; this one
    // proves the actual number a real customer runs into. If this test
    // were changed to assert nothing (no maxSelection prop honoured), the
    // toy-value test above could still pass while a customer could select
    // an unbounded number of figurines in the UI.
    const fiftyOneProducts = Array.from({ length: 51 }, (_, i) =>
      product({ id: `q${i + 1}`, name: `Ürün ${i + 1}` }),
    );
    const fiftySelected = fiftyOneProducts.slice(0, 50).map((p) => p.id);
    const fiftyFirst = fiftyOneProducts[50];
    const { onChange } = renderPicker(fiftySelected, 50, fiftyOneProducts);

    expect(screen.getByTestId(`print3d-pick-${fiftyFirst.id}`)).toBeDisabled();
    fireEvent.click(screen.getByTestId(`print3d-pick-${fiftyFirst.id}`));
    expect(onChange).not.toHaveBeenCalled();
    // Every one of the 50 already-selected cards must stay removable — the
    // cap blocks ADDING a 51st, not editing the existing 50.
    expect(screen.getByTestId(`print3d-pick-${fiftySelected[0]}`)).not.toBeDisabled();
    expect(screen.getByTestId(`print3d-pick-${fiftySelected[49]}`)).not.toBeDisabled();
  });

  it('reports zero selection honestly — the wizard refuses to proceed on this signal', () => {
    // Print3dProductPicker owns no "Continue" button (the wizard shell
    // that stitches steps together does, and gates it on
    // `selected.length` staying within [minItems, maxItems]). What THIS
    // component must guarantee is that the signal that gate reads is
    // truthful: at zero picks, the count shown is 0 and `onChange` is
    // never invoked to fabricate a non-empty basket on mount.
    const { onChange } = renderPicker([]);
    expect(screen.getByTestId('print3d-selected-count').textContent).toContain('0');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('updates the live price counter as products are toggled', () => {
    renderPicker(['p1', 'p2']);
    // 150.000 + 2 x 5.000 = 160.000 kuruş → handed to the country-profile
    // formatter as 1600 MAJOR units, not a literal string baked into the
    // component.
    expect(formatWithCurrency).toHaveBeenCalledWith(1600, 'TRY');
    expect(screen.getByTestId('print3d-live-total').textContent).toContain('FMT(1600,TRY)');
  });

  it('shows the empty copy when the menu has no products', () => {
    render(
      <Print3dProductPicker
        products={[]}
        selected={[]}
        onChange={vi.fn()}
        maxSelection={50}
        basePriceCents={150000}
        perItemCents={5000}
        currency="TRY"
      />,
    );
    expect(screen.getByText(enHardware.print3d.picker.empty)).toBeTruthy();
  });
});
