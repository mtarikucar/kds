import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Specs for the QR menu's responsive layout contract.
 *
 * Every rule here was measured in Chromium against a live tenant before it
 * was written, and every one of them is a decision OUR OWN code makes — a
 * Tailwind class we emit — never a locale-derived string. jsdom and Chromium
 * disagree about number/currency formatting, so an assertion on rendered
 * money passes here and still ships broken; an assertion on the classes we
 * choose does not have that failure mode.
 *
 * What was measured (Chromium, pamukkale.hummytummy.com):
 *  - the grid quick-add button was 36x36 and painted 1296px² on top of the
 *    dish description (450px² on top of the title at >=430px);
 *  - the cart summary was pinned at bottom-20 for a bottom nav that does not
 *    exist on /cart, so at 320x568 it covered the stepper, the remove button
 *    and Special Notes on first paint;
 *  - the product sheet was viewport-wide at >=1024px, its 4:3 hero alone
 *    taller than the window, so the sheet showed only the photo;
 *  - <main> had no max width and the grid stayed at 2 columns at every width,
 *    so a 1440px desktop showed FEWER dishes than a tablet;
 *  - a cart item title truncated mid-word at 320px with vertical room to spare;
 *  - a fistful of controls were under the 44px minimum tap target.
 */

const stableT = (k: string, fb?: unknown) => (typeof fb === 'string' ? fb : k);
const stableI18n = { language: 'en' };
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: stableT, i18n: stableI18n }),
}));

vi.mock('framer-motion', () => {
  const MOTION_ONLY_PROPS = new Set([
    'initial', 'animate', 'exit', 'transition', 'variants', 'whileHover',
    'whileTap', 'whileFocus', 'layout', 'layoutId', 'drag', 'dragConstraints',
    'dragElastic', 'onDragEnd', 'mode',
  ]);
  return {
    motion: new Proxy({}, {
      get: (_t, tag: string) => ({ children, ...p }: any) => {
        const Tag = tag as any;
        const rest = Object.fromEntries(
          Object.entries(p).filter(([k]) => !MOTION_ONLY_PROPS.has(k)),
        );
        return <Tag {...rest}>{children}</Tag>;
      },
    }),
    AnimatePresence: ({ children }: any) => <>{children}</>,
    useMotionValue: (v: unknown) => ({ get: () => v, set: () => {}, on: () => () => {} }),
    useTransform: () => ({ get: () => 0, set: () => {}, on: () => () => {} }),
    animate: () => ({ stop: () => {} }),
    PanInfo: {},
  };
});

// --- QRMenuLayout dependencies -------------------------------------------
const get = vi.fn();
const post = vi.fn();
vi.mock('axios', async () => {
  const actual = await vi.importActual<typeof import('axios')>('axios');
  return {
    ...actual,
    default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
  };
});
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock('../../components/ui/Spinner', () => ({ default: () => <div data-testid="spinner" /> }));
vi.mock('../../components/qr-menu/MenuDrawer', () => ({ default: () => null }));
vi.mock('../../i18n/config', () => ({ RTL_LANGUAGES: ['ar', 'he'], default: {} }));

const ensureCustomerSession = vi.fn().mockResolvedValue('a'.repeat(64));
vi.mock('../../features/qr-menu/customerSession', () => ({
  ensureCustomerSession: (...a: unknown[]) => ensureCustomerSession(...a),
  retryWith401Remint: async (fn: (sid: string) => Promise<unknown>, sid: string) => fn(sid),
  withCustomerSession: async (fn: (sid: string) => Promise<unknown>) => fn('a'.repeat(64)),
}));

const addItem = vi.fn();
const updateQuantity = vi.fn();
const removeItem = vi.fn();
// CartContent calls useCartStore() with no selector; QRMenuLayout passes one.
vi.mock('../../store/cartStore', () => ({
  useCartStore: (selector?: any) => (selector ?? ((s: any) => s))({
    sessionId: 'sess-1',
    items: cartItems,
    tenantId: 't-1',
    tableId: null,
    getTotal: () => 100,
    getSubtotal: () => 100,
    getItemCount: () => cartItems.length,
    initializeSession: vi.fn(),
    addItem,
    updateQuantity,
    removeItem,
    reorderItems: vi.fn(),
    clearCart: vi.fn(),
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ tenantId: 't-1' }),
    useSearchParams: () => [{ get: () => null }],
    useNavigate: () => vi.fn(),
  };
});

import ProductCard from '../../components/qr-menu/ProductCard';
import CategoryBar from '../../components/qr-menu/CategoryBar';
import BottomSheet from '../../components/qr-menu/BottomSheet';
import SortableCartItem from '../../components/qr-menu/SortableCartItem';
import CartContent from '../../components/qr-menu/CartContent';
import ProductDetailModalWithCart from './ProductDetailModalWithCart';
import { gridColumnsClass } from '../../components/qr-menu/QRMenuContent';
import QRMenuLayout from './QRMenuLayout';

const product: any = {
  id: 'p-1',
  name: 'Türk Kahvaltısı Set',
  description: 'Tam dolu sini · 2 kişilik dadlar',
  price: 50000,
  isAvailable: true,
  images: [],
};

let cartItems: any[] = [];

const settings: any = {
  primaryColor: '#f97316',
  secondaryColor: '#0f172a',
  backgroundColor: '#fff',
  fontFamily: 'sans',
  showImages: true,
  showDescription: true,
  showPrices: true,
  layoutStyle: 'GRID',
  itemsPerRow: 2,
};

function renderCard(layoutStyle: 'GRID' | 'LIST') {
  return render(
    <ProductCard
      product={product}
      onClick={() => {}}
      onQuickAdd={() => {}}
      primaryColor="#f97316"
      secondaryColor="#0f172a"
      currency="UZS"
      showImages
      showDescription
      showPrices
      enableCustomerOrdering
      layoutStyle={layoutStyle}
    />,
  );
}

function renderCart() {
  cartItems = [{
    id: 'i-1',
    product,
    quantity: 1,
    modifiers: [],
    itemTotal: 50000,
    notes: '',
  }];
  return render(
    <MemoryRouter>
      <CartContent
        settings={settings}
        enableCustomerOrdering
        currency="UZS"
        onSubmitOrder={() => {}}
        onShowTableSelection={() => {}}
        isSubmitting={false}
        tenantId="t-1"
        specialNotes=""
        onSpecialNotesChange={() => {}}
      />
    </MemoryRouter>,
  );
}

/** Every tap target must be at least 44px in both axes; a Tailwind size or
 *  padding class is the only thing jsdom can see, so we read the classes. */
function sizeClasses(el: Element): string {
  return el.className.toString();
}

beforeEach(() => {
  vi.clearAllMocks();
  cartItems = [];
});

describe('ProductCard — the quick-add button must not sit on the copy', () => {
  it('gives the GRID quick-add a 44px box and keeps the h-4 icon', () => {
    const { container } = renderCard('GRID');
    const quickAdd = container.querySelector('article > button');
    expect(quickAdd).not.toBeNull();
    // 36x36 (p-2.5 around an h-4 icon) was both under the tap-target floor and
    // small enough to look like decoration.
    expect(sizeClasses(quickAdd!)).toContain('h-11');
    expect(sizeClasses(quickAdd!)).toContain('w-11');
    expect(quickAdd!.querySelector('svg')?.getAttribute('class')).toContain('h-4');
  });

  it('reserves the button lane so the title and description wrap before it', () => {
    renderCard('GRID');
    const title = screen.getByText(product.name);
    const wrapper = title.closest('div')?.parentElement;
    // pe-14 == the 44px button plus its bottom-3/right-3 inset.
    expect(sizeClasses(wrapper!)).toContain('pe-14');
  });

  it('gives the LIST quick-add the same 44px box', () => {
    const { container } = renderCard('LIST');
    const quickAdd = container.querySelector('article button:last-of-type');
    expect(sizeClasses(quickAdd!)).toContain('h-11');
    expect(sizeClasses(quickAdd!)).toContain('w-11');
  });

  it('lets a LIST row grow instead of clipping its description', () => {
    const { container } = renderCard('LIST');
    const card = container.querySelector('article')!;
    // A 44px quick-add plus a two-line description overflows 112px at 320px
    // wide; h-28 clipped the description, min-h-28 grows the row.
    expect(sizeClasses(card)).toContain('min-h-28');
    expect(sizeClasses(card)).not.toMatch(/(^|\s)h-28(\s|$)/);
  });

  it('does not reserve the lane in LIST, where the button is already in flow', () => {
    const title = screen.queryByText(product.name);
    expect(title).toBeNull(); // guard: previous render torn down
    const { container } = renderCard('LIST');
    const wrapper = container.querySelector('article > div:last-of-type');
    expect(sizeClasses(wrapper!)).not.toContain('pe-14');
  });
});

describe('CartContent — the summary panel sits on the bottom edge', () => {
  it('is not offset for a bottom nav that /cart does not have', () => {
    const { container } = renderCart();
    const panel = container.querySelector('.fixed.z-30, .z-30.fixed')
      ?? [...container.querySelectorAll('div')].find((d) => d.className.toString().includes('z-30'));
    expect(panel).toBeTruthy();
    const cls = sizeClasses(panel!);
    // bottom-20 reserved 80px for a nav that isn't rendered here, which at
    // 320x568 pushed the panel up over the stepper/remove/notes.
    expect(cls).not.toContain('bottom-20');
    expect(cls).toContain('bottom-0');
  });

  it('pads the scrolling column by the panel height plus the safe area', () => {
    const { container } = renderCart();
    const scroller = container.firstElementChild as HTMLElement;
    expect(sizeClasses(scroller)).toContain('env(safe-area-inset-bottom');
  });

  it('grows the Continue Shopping hit box without moving the text', () => {
    renderCart();
    const back = screen.getByText('Continue Shopping').closest('button')!;
    // 20px tall as shipped; py-3 -my-3 buys 44px of hit box at the same y.
    expect(sizeClasses(back)).toContain('py-3');
    expect(sizeClasses(back)).toContain('-my-3');
  });
});

describe('SortableCartItem — 320px readability and tap targets', () => {
  function renderItem() {
    cartItems = [];
    return render(
      <SortableCartItem
        item={{ id: 'i-1', product, quantity: 1, modifiers: [], itemTotal: 50000 } as any}
        currency="UZS"
        primaryColor="#f97316"
        secondaryColor="#0f172a"
        onUpdateQuantity={() => {}}
        onRemove={() => {}}
      />,
    );
  }

  it('wraps the dish title to two lines instead of truncating it mid-word', () => {
    renderItem();
    const title = screen.getByText(product.name);
    expect(sizeClasses(title)).toContain('line-clamp-2');
    expect(sizeClasses(title)).not.toContain('truncate');
  });

  it('gives the quantity steppers and the remove button 44px boxes', () => {
    const { container } = renderItem();
    const buttons = [...container.querySelectorAll('button')];
    const steppers = buttons.filter((b) => sizeClasses(b).includes('min-w-'));
    expect(steppers).toHaveLength(2);
    for (const b of steppers) {
      expect(sizeClasses(b)).toContain('min-w-11');
      expect(sizeClasses(b)).toContain('min-h-11');
    }
    const remove = buttons[buttons.length - 1];
    expect(sizeClasses(remove)).toContain('h-11');
    expect(sizeClasses(remove)).toContain('w-11');
  });
});

describe('BottomSheet — a sheet, not a full-bleed wall, on wide screens', () => {
  it('caps its width and rounds all corners once there is room', () => {
    const { container } = render(
      <BottomSheet isOpen onClose={() => {}}>
        <div data-testid="sheet-child" />
      </BottomSheet>,
    );
    const sheet = [...container.querySelectorAll('div')].find((d) =>
      d.className.toString().includes('rounded-t-3xl'));
    expect(sheet).toBeTruthy();
    // SelfPayModal's house convention: w-full on phones, capped and fully
    // rounded from sm up.
    expect(sizeClasses(sheet!)).toContain('sm:max-w-lg');
    expect(sizeClasses(sheet!)).toContain('sm:rounded-3xl');
  });

  it('caps the product hero so the name and CTA are reachable', () => {
    const { container } = render(
      <ProductDetailModalWithCart
        isOpen
        onClose={() => {}}
        product={product}
        primaryColor="#f97316"
        secondaryColor="#0f172a"
        showImages
        showDescription
        showPrices
        enableCustomerOrdering
        currency="UZS"
      />,
    );
    const hero = [...container.querySelectorAll('div')].find((d) =>
      d.className.toString().includes('aspect-[4/3]'));
    expect(hero).toBeTruthy();
    // A 4:3 hero on a 1440px-wide sheet is 1080px tall — taller than the
    // window, which is why the sheet showed nothing but the photo.
    expect(sizeClasses(hero!)).toContain('max-h-[45vh]');
  });
});

describe('CategoryBar — chip tap targets', () => {
  it('gives every chip a 44px-tall box', () => {
    const { container } = render(
      <CategoryBar
        categories={[{ id: 'c-1', name: 'Kahvaltı' } as any]}
        selectedCategory=""
        activeSection=""
        primaryColor="#f97316"
        onCategoryClick={() => {}}
      />,
    );
    const chips = [...container.querySelectorAll('button')];
    expect(chips.length).toBeGreaterThan(1);
    for (const chip of chips) {
      expect(sizeClasses(chip)).toContain('py-3');
      expect(sizeClasses(chip)).not.toContain('py-2.5');
    }
  });
});

describe('QRMenuContent — columns scale up from the merchant setting', () => {
  it('treats itemsPerRow as the NARROWEST column count, never as a cap', () => {
    // A merchant who picked 2 must still get 2 columns on a phone …
    expect(gridColumnsClass(2)).toContain('grid-cols-2');
    // … and more of them as the viewport grows, instead of 688px-wide cards.
    expect(gridColumnsClass(2)).toContain('sm:grid-cols-3');
    expect(gridColumnsClass(2)).toContain('lg:grid-cols-4');

    expect(gridColumnsClass(1)).toContain('grid-cols-1');
    expect(gridColumnsClass(1)).toContain('sm:grid-cols-2');

    // A merchant who asked for denser rows keeps their edge at every step.
    expect(gridColumnsClass(3)).toContain('sm:grid-cols-3');
    expect(gridColumnsClass(3)).toContain('xl:grid-cols-5');
  });
});

describe('QRMenuLayout — the reading column has a maximum width', () => {
  it('caps <main> and centres it', async () => {
    get.mockResolvedValue({
      data: {
        tenant: { id: 't-1', name: 'Acme Diner', currency: 'UZS' },
        settings: { primaryColor: '#fff', backgroundColor: '#fff', fontFamily: 'sans', showImages: true },
        enableCustomerOrdering: true,
        enableTablelessMode: false,
        categories: [],
      },
    });
    const { container } = render(
      <MemoryRouter>
        <QRMenuLayout currentPage="menu">
          <div data-testid="child" />
        </QRMenuLayout>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('child')).toBeInTheDocument());
    const main = container.querySelector('main')!;
    expect(sizeClasses(main)).toContain('max-w-6xl');
    expect(sizeClasses(main)).toContain('mx-auto');
  });

  it('gives the drawer button a 44px box', async () => {
    get.mockResolvedValue({
      data: {
        tenant: { id: 't-1', name: 'Acme Diner', currency: 'UZS' },
        settings: { primaryColor: '#fff', backgroundColor: '#fff', fontFamily: 'sans', showImages: true },
        enableCustomerOrdering: true,
        enableTablelessMode: false,
        categories: [],
      },
    });
    const { container } = render(
      <MemoryRouter>
        <QRMenuLayout currentPage="menu">
          <div data-testid="child" />
        </QRMenuLayout>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('child')).toBeInTheDocument());
    const hamburger = container.querySelector('header button')!;
    expect(sizeClasses(hamburger)).toContain('p-2.5');
  });
});
