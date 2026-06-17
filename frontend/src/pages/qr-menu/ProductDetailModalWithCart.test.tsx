import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Product, ModifierGroup } from '../../types';
import { SelectionType } from '../../types';

/**
 * Real specs for the QR-menu product modal's cart logic: modifier
 * single/multi selection, min/max enforcement, the running money total
 * (product price + Σ modifier adjustments × qty × quantity), the
 * required-modifier gate, and the exact payload handed to the cart
 * store on add. The heavy presentational children (BottomSheet,
 * ProductImageGallery) and framer-motion are stubbed to thin DOM so the
 * assertions target the unit's branching, not animation internals.
 */

const addItemMock = vi.fn();
vi.mock('../../store/cartStore', () => ({
  useCartStore: (selector: (s: { addItem: typeof addItemMock }) => unknown) =>
    selector({ addItem: addItemMock }),
}));

// BottomSheet renders its children only when open — mirror that so the
// `isOpen` branch is still exercised, minus the drag/portal machinery.
vi.mock('../../components/qr-menu/BottomSheet', () => ({
  default: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div data-testid="bottom-sheet">{children}</div> : null,
}));

vi.mock('../../components/qr-menu/ProductImageGallery', () => ({
  default: ({ images }: { images: { url: string }[] }) => (
    <div data-testid="gallery" data-count={images.length} />
  ),
}));

// framer-motion: render motion.* as plain elements and pass through
// children so AnimatePresence content (accordion bodies) is always in
// the DOM regardless of enter/exit animation state.
vi.mock('framer-motion', () => {
  // IMPORTANT: cache one component per tag so the component *identity* is
  // stable across renders. A fresh function per render makes React treat
  // each render as a new element type → remount → detached DOM nodes,
  // which silently breaks click handlers that close over current state.
  const cache = new Map<string, React.FC<Record<string, unknown>>>();
  const passthrough = (tag: string) => {
    if (!cache.has(tag)) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- strip motion-only props so they don't reach the DOM
      cache.set(tag, ({ children, whileTap, animate, initial, exit, transition, mode, layout, ...rest }: Record<string, unknown>) => {
        const El = tag as keyof JSX.IntrinsicElements;
        return <El {...(rest as Record<string, unknown>)}>{children as React.ReactNode}</El>;
      });
    }
    return cache.get(tag)!;
  };
  return {
    motion: new Proxy({}, { get: (_t, tag: string) => passthrough(tag) }),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

import ProductDetailModalWithCart from './ProductDetailModalWithCart';

// The quantity stepper buttons are icon-only (no accessible name). Locate
// them structurally: the "1" qty display sits between the minus (prev)
// and plus (next) buttons inside the stepper container.
// Non-required groups render their chips behind a collapsed accordion;
// click the header (the group's displayName) to reveal them.
function expandGroup(displayName: string | RegExp) {
  fireEvent.click(screen.getByRole('button', { name: displayName }));
}

function stepperButtons() {
  const qty = Array.from(document.querySelectorAll('span.w-8.text-center')).find(
    (el) => /^\d+$/.test(el.textContent || ''),
  );
  const stepper = qty!.parentElement as HTMLElement;
  const btns = stepper.querySelectorAll('button');
  return {
    minus: btns[0] as HTMLButtonElement,
    plus: btns[1] as HTMLButtonElement,
    value: qty!.textContent,
  };
}

function makeGroup(overrides: Partial<ModifierGroup>): ModifierGroup {
  return {
    id: 'g1',
    name: 'extras',
    displayName: 'Extras',
    selectionType: SelectionType.MULTIPLE,
    minSelections: 0,
    maxSelections: undefined,
    isRequired: false,
    displayOrder: 0,
    isActive: true,
    tenantId: 't1',
    modifiers: [],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    name: 'Burger',
    description: 'Juicy',
    price: 10,
    image: null,
    images: [],
    modifierGroups: [],
    categoryId: 'c1',
    currentStock: 5,
    stockTracked: false,
    isAvailable: true,
    displayOrder: 0,
    tenantId: 't1',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  primaryColor: '#111',
  secondaryColor: '#222',
  showImages: false,
  showDescription: true,
  showPrices: true,
  enableCustomerOrdering: true,
  currency: 'TRY',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('ProductDetailModalWithCart — render gating', () => {
  it('renders nothing when product is null', () => {
    const { container } = render(
      <ProductDetailModalWithCart {...baseProps} product={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when closed (BottomSheet hidden)', () => {
    render(
      <ProductDetailModalWithCart
        {...baseProps}
        isOpen={false}
        product={makeProduct()}
      />,
    );
    expect(screen.queryByTestId('bottom-sheet')).not.toBeInTheDocument();
  });

  it('shows view-only banner (no add button) when ordering disabled', () => {
    render(
      <ProductDetailModalWithCart
        {...baseProps}
        enableCustomerOrdering={false}
        product={makeProduct()}
      />,
    );
    expect(screen.queryByRole('button', { name: /Add to Cart/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Menu viewing only/i)).toBeInTheDocument();
  });
});

describe('ProductDetailModalWithCart — money total', () => {
  it('shows the bare product price when no modifiers/quantity changes', () => {
    render(<ProductDetailModalWithCart {...baseProps} product={makeProduct({ price: 12.5 })} />);
    // Add button label contains the running total.
    expect(screen.getByRole('button', { name: /₺12,50/ })).toBeInTheDocument();
  });

  it('multiplies (price + modifier adjustments) by quantity', () => {
    const product = makeProduct({
      price: 10,
      modifierGroups: [
        makeGroup({
          modifiers: [
            {
              id: 'm1', name: 'cheese', displayName: 'Cheese', priceAdjustment: 2,
              isAvailable: true, displayOrder: 0, groupId: 'g1', tenantId: 't1',
              createdAt: '', updatedAt: '',
            },
          ],
        }),
      ],
    });
    render(<ProductDetailModalWithCart {...baseProps} product={product} />);

    // select +$2 modifier -> base 12
    expandGroup(/Extras/);
    fireEvent.click(screen.getByRole('button', { name: /Cheese/ }));
    expect(screen.getByRole('button', { name: /₺12,00/ })).toBeInTheDocument();

    // bump quantity to 2 -> (10 + 2) * 2 = 24
    fireEvent.click(stepperButtons().plus);
    expect(screen.getByRole('button', { name: /₺24,00/ })).toBeInTheDocument();
  });
});

describe('ProductDetailModalWithCart — quantity stepper', () => {
  it('clamps the minus button at 1 (disabled, never goes to 0)', () => {
    render(<ProductDetailModalWithCart {...baseProps} product={makeProduct()} />);
    const { minus } = stepperButtons();
    expect(minus).toBeDisabled();
    fireEvent.click(minus);
    // total still single-quantity price = $10.00
    expect(screen.getByRole('button', { name: /₺10,00/ })).toBeInTheDocument();
    expect(stepperButtons().value).toBe('1');
  });
});

describe('ProductDetailModalWithCart — single-select modifier group', () => {
  const product = makeProduct({
    modifierGroups: [
      makeGroup({
        id: 'size',
        displayName: 'Size',
        selectionType: SelectionType.SINGLE,
        modifiers: [
          { id: 's', name: 's', displayName: 'Small', priceAdjustment: 0, isAvailable: true, displayOrder: 0, groupId: 'size', tenantId: 't1', createdAt: '', updatedAt: '' },
          { id: 'l', name: 'l', displayName: 'Large', priceAdjustment: 3, isAvailable: true, displayOrder: 1, groupId: 'size', tenantId: 't1', createdAt: '', updatedAt: '' },
        ],
      }),
    ],
  });

  it('picking a second option replaces the first (only one stays selected)', () => {
    render(<ProductDetailModalWithCart {...baseProps} product={product} />);
    expandGroup(/Size/);
    fireEvent.click(screen.getByRole('button', { name: /Large/ }));
    // +3 reflected
    expect(screen.getByRole('button', { name: /₺13,00/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Small/ }));
    // back to base 10 — Large was replaced, not added
    expect(screen.getByRole('button', { name: /₺10,00/ })).toBeInTheDocument();
  });

  it('clicking the selected single option again deselects it', () => {
    render(<ProductDetailModalWithCart {...baseProps} product={product} />);
    expandGroup(/Size/);
    const large = screen.getByRole('button', { name: /Large/ });
    fireEvent.click(large);
    expect(screen.getByRole('button', { name: /₺13,00/ })).toBeInTheDocument();
    fireEvent.click(large);
    expect(screen.getByRole('button', { name: /₺10,00/ })).toBeInTheDocument();
  });
});

describe('ProductDetailModalWithCart — multi-select max enforcement', () => {
  const product = makeProduct({
    modifierGroups: [
      makeGroup({
        id: 'top',
        displayName: 'Toppings',
        selectionType: SelectionType.MULTIPLE,
        maxSelections: 2,
        modifiers: [
          { id: 'a', name: 'a', displayName: 'Bacon', priceAdjustment: 1, isAvailable: true, displayOrder: 0, groupId: 'top', tenantId: 't1', createdAt: '', updatedAt: '' },
          { id: 'b', name: 'b', displayName: 'Egg', priceAdjustment: 1, isAvailable: true, displayOrder: 1, groupId: 'top', tenantId: 't1', createdAt: '', updatedAt: '' },
          { id: 'c', name: 'c', displayName: 'Onion', priceAdjustment: 1, isAvailable: true, displayOrder: 2, groupId: 'top', tenantId: 't1', createdAt: '', updatedAt: '' },
        ],
      }),
    ],
  });

  it('refuses the 3rd selection once maxSelections (2) is reached', () => {
    render(<ProductDetailModalWithCart {...baseProps} product={product} />);
    expandGroup(/Toppings/);
    fireEvent.click(screen.getByRole('button', { name: /Bacon/ }));
    fireEvent.click(screen.getByRole('button', { name: /Egg/ }));
    // 10 + 1 + 1 = 12
    expect(screen.getByRole('button', { name: /₺12,00/ })).toBeInTheDocument();
    // third one is a no-op (still $12, not $13)
    fireEvent.click(screen.getByRole('button', { name: /Onion/ }));
    expect(screen.getByRole('button', { name: /₺12,00/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /₺13,00/ })).not.toBeInTheDocument();
  });

  it('deselecting frees a slot so a different option can be chosen', () => {
    render(<ProductDetailModalWithCart {...baseProps} product={product} />);
    expandGroup(/Toppings/);
    fireEvent.click(screen.getByRole('button', { name: /Bacon/ }));
    fireEvent.click(screen.getByRole('button', { name: /Egg/ }));
    fireEvent.click(screen.getByRole('button', { name: /Bacon/ })); // deselect bacon
    fireEvent.click(screen.getByRole('button', { name: /Onion/ })); // now allowed
    expect(screen.getByRole('button', { name: /₺12,00/ })).toBeInTheDocument();
  });
});

describe('ProductDetailModalWithCart — required-modifier gate', () => {
  const product = makeProduct({
    modifierGroups: [
      makeGroup({
        id: 'req',
        displayName: 'Sauce',
        selectionType: SelectionType.SINGLE,
        isRequired: true,
        minSelections: 1,
        modifiers: [
          { id: 'k', name: 'k', displayName: 'Ketchup', priceAdjustment: 0, isAvailable: true, displayOrder: 0, groupId: 'req', tenantId: 't1', createdAt: '', updatedAt: '' },
        ],
      }),
    ],
  });

  it('blocks add-to-cart until the required group is satisfied', () => {
    render(<ProductDetailModalWithCart {...baseProps} product={product} />);
    expect(screen.getByRole('button', { name: /Add to Cart/ })).toBeDisabled();
    expect(screen.getByText(/Please select required options/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Add to Cart/ }));
    expect(addItemMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Ketchup/ }));
    expect(screen.getByRole('button', { name: /Add to Cart/ })).not.toBeDisabled();
    expect(screen.queryByText(/Please select required options/i)).not.toBeInTheDocument();
  });
});

describe('ProductDetailModalWithCart — addItem payload', () => {
  it('dispatches product, quantity, flattened modifiers and trimmed notes', () => {
    vi.useFakeTimers();
    const product = makeProduct({
      price: 10,
      modifierGroups: [
        makeGroup({
          modifiers: [
            { id: 'm1', name: 'cheese', displayName: 'Cheese', priceAdjustment: 2, isAvailable: true, displayOrder: 0, groupId: 'g1', tenantId: 't1', createdAt: '', updatedAt: '' },
          ],
        }),
      ],
    });
    render(<ProductDetailModalWithCart {...baseProps} product={product} />);

    expandGroup(/Extras/);
    fireEvent.click(screen.getByRole('button', { name: /Cheese/ }));
    fireEvent.click(stepperButtons().plus); // qty 2
    fireEvent.change(screen.getByPlaceholderText(/No onions/i), {
      target: { value: 'extra crispy' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Add to Cart/ }));

    expect(addItemMock).toHaveBeenCalledTimes(1);
    const [passedProduct, qty, mods, notes] = addItemMock.mock.calls[0];
    expect(passedProduct.id).toBe('p1');
    expect(qty).toBe(2);
    expect(mods).toEqual([
      { id: 'm1', name: 'cheese', displayName: 'Cheese', priceAdjustment: 2, quantity: 1 },
    ]);
    expect(notes).toBe('extra crispy');

    // After the success window + close delay, onClose fires.
    act(() => {
      vi.advanceTimersByTime(1200 + 300);
    });
    expect(baseProps.onClose).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('passes undefined notes when the field is left empty', () => {
    vi.useFakeTimers();
    render(<ProductDetailModalWithCart {...baseProps} product={makeProduct()} />);
    fireEvent.click(screen.getByRole('button', { name: /Add to Cart/ }));
    const [, , , notes] = addItemMock.mock.calls[0];
    expect(notes).toBeUndefined();
    vi.useRealTimers();
  });
});
