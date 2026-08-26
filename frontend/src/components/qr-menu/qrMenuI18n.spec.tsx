import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18next from 'i18next';
import MenuDrawer from './MenuDrawer';
import CartContent from './CartContent';

import enCommon from '../../i18n/locales/en/common.json';
import trCommon from '../../i18n/locales/tr/common.json';
import ruCommon from '../../i18n/locales/ru/common.json';
import uzCommon from '../../i18n/locales/uz/common.json';
import arCommon from '../../i18n/locales/ar/common.json';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let cartItems: unknown[] = [];
vi.mock('../../store/cartStore', () => ({
  useCartStore: () => ({
    items: cartItems,
    updateItemQuantity: vi.fn(),
    removeItem: vi.fn(),
    reorderItems: vi.fn(),
    getSubtotal: () => 0,
    getTotal: () => 0,
    sessionId: 'sess-1',
  }),
}));

const BUNDLES: Record<string, Record<string, unknown>> = {
  en: enCommon,
  tr: trCommon,
  ru: ruCommon,
  uz: uzCommon,
  ar: arCommon,
};
const LOCALES = Object.keys(BUNDLES);

const lookup = (bundle: Record<string, unknown>, key: string) =>
  key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      bundle,
    );

afterAll(async () => {
  await i18next.changeLanguage('en');
});

beforeEach(() => {
  cartItems = [];
});

/**
 * Every string the QR drawer/cart/menu renders must exist in all five
 * locale bundles. A key that is missing from EVERY bundle survives the
 * locale-parity gate (it compares the bundles to each other), so the
 * defaultValue leaks English onto a Turkish tenant's phone — which is
 * exactly what the live pamukkale menu was doing.
 */
describe('qr-menu guest strings exist in every locale', () => {
  const KEYS = [
    'qrMenu.all',
    'qrMenu.noProducts',
    'qrMenu.noProductsDescription',
    'qrMenu.clearFilters',
    'cart.swipeToDelete',
    'cart.dragToReorder',
    'cart.empty',
    'common.delete',
    'common.language',
    'common.copyFailed',
    'loyalty.viewRewards',
  ];

  for (const locale of LOCALES) {
    it(`${locale} defines all of them`, () => {
      const missing = KEYS.filter(
        (key) => typeof lookup(BUNDLES[locale], key) !== 'string',
      );
      expect(missing).toEqual([]);
    });
  }

  it('translates them away from the English source text', () => {
    for (const key of KEYS) {
      for (const locale of ['tr', 'ru', 'uz', 'ar']) {
        expect(lookup(BUNDLES[locale], key)).not.toBe(
          lookup(BUNDLES.en, key),
        );
      }
    }
  });
});

/**
 * `items.length === 1 ? t('cart.item') : t('cart.items')` can only ever
 * produce two forms. Russian needs one/few/many and Arabic needs six, so
 * the ternary shipped "5 товар" to every Russian guest. Delegate to
 * i18next's plural resolver instead.
 */
describe('cart item count uses real plural categories', () => {
  const formsFor = async (locale: string, counts: number[]) => {
    await i18next.changeLanguage(locale);
    return counts.map((count) => i18next.t('cart.itemCount', { count }));
  };

  it('gives Russian three distinct forms for 1 / 2 / 5', async () => {
    const [one, few, many] = await formsFor('ru', [1, 2, 5]);
    expect(new Set([one, few, many]).size).toBe(3);
    expect(one).toBe(
      (lookup(ruCommon, 'cart.itemCount_one') as string).replace(
        '{{count}}',
        '1',
      ),
    );
    expect(many).toBe(
      (lookup(ruCommon, 'cart.itemCount_many') as string).replace(
        '{{count}}',
        '5',
      ),
    );
  });

  it('gives Arabic distinct forms for 1 / 2 / 3 / 11', async () => {
    const forms = await formsFor('ar', [1, 2, 3, 11]);
    expect(new Set(forms).size).toBe(4);
  });

  it('renders the resolved plural in the cart header', async () => {
    cartItems = [1, 2, 3, 4, 5].map((n) => ({
      id: `i${n}`,
      quantity: 1,
      modifiers: [],
      product: { id: `p${n}`, name: `Item ${n}`, price: 100 },
    }));
    await i18next.changeLanguage('ru');
    render(
      <MemoryRouter>
        <CartContent
          settings={{ primaryColor: '#FF6B6B', secondaryColor: '#6366f1' } as never}
          enableCustomerOrdering
          currency="TRY"
          onSubmitOrder={() => {}}
          onShowTableSelection={() => {}}
          isSubmitting={false}
          specialNotes=""
          onSpecialNotesChange={() => {}}
        />
      </MemoryRouter>,
    );
    const many = (lookup(ruCommon, 'cart.itemCount_many') as string).replace(
      '{{count}}',
      '5',
    );
    expect(screen.getByText(many)).toBeInTheDocument();
  });
});

/**
 * index.css already flips every `[dir="rtl"] .fixed.right-0` panel to the
 * left edge. The drawer ALSO branched on isRTL and emitted `right-0`, so
 * the two flips cancelled and the Arabic drawer slid in from the left.
 * The component must emit one side only and let the stylesheet mirror it.
 */
describe('MenuDrawer RTL anchoring', () => {
  const drawerPanel = () =>
    document.querySelector('.fixed.top-0.bottom-0') as HTMLElement | null;

  const renderDrawer = () =>
    render(
      <MemoryRouter>
        <MenuDrawer
          isOpen
          onClose={() => {}}
          tenant={{ id: 't1', name: 'Acme Diner' }}
          settings={{ primaryColor: '#FF6B6B', secondaryColor: '#6366f1' }}
          sessionId="sess-1"
        />
      </MemoryRouter>,
    );

  it('anchors to left-0 in Arabic and leaves the flip to the stylesheet', async () => {
    await i18next.changeLanguage('ar');
    renderDrawer();
    const panel = drawerPanel();
    expect(panel).not.toBeNull();
    expect(panel!.className).toContain('left-0');
    expect(panel!.className).not.toContain('right-0');
  });

  it('anchors to left-0 in Turkish too', async () => {
    await i18next.changeLanguage('tr');
    renderDrawer();
    expect(drawerPanel()!.className).toContain('left-0');
  });

  it('labels the language picker in the active locale', async () => {
    await i18next.changeLanguage('tr');
    renderDrawer();
    expect(
      screen.getByText(lookup(trCommon, 'common.language') as string),
    ).toBeInTheDocument();
    expect(screen.queryByText('Language')).not.toBeInTheDocument();
  });
});
