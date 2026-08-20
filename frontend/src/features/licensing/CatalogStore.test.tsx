import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import CatalogStore from './CatalogStore';

/**
 * The storefront builds the basket that gets charged, so the tests that matter
 * are about what ends up on the bill and what it says it costs.
 *
 * Two numbers are in play for every annual line: the prorated price (what this
 * tenant pays TODAY, because a mid-year purchase only runs to the anniversary)
 * and the list price (what it costs at renewal). The total must be built from
 * the first — quoting list would overstate a mid-year basket by up to twelve
 * times — while still telling the customer the second.
 */
let products: any[];
let owned: any[];
let licenseStatus: string;
let offers: Record<string, any>;
/** Product code → the SERVER's verdict, exactly as /v1/me/licensing returns it. */
let purchasability: Record<string, { ok: boolean; reason?: string }>;
const purchaseAsync = vi.fn();

vi.mock('./licensingApi', async () => {
  const actual = await vi.importActual<typeof import('./licensingApi')>(
    './licensingApi',
  );
  return {
    ...actual,
    useCatalogPricing: () => ({ data: products, isLoading: false }),
  };
});

vi.mock('../../contexts/SubscriptionContext', () => ({
  useEntitlements: () => ({
    owned,
    license: { status: licenseStatus },
    snapshot: { offers, purchasability },
    offerFor: () => null,
  }),
}));

vi.mock('../marketplace/marketplaceApi', () => ({
  usePurchaseAddOnViaCheckout: () => ({ mutateAsync: purchaseAsync }),
}));

// Consent has its own spec; here it would drag the legal-document queries into
// every case. Ticked by default so the pay button is reachable, except where a
// test overrides it.
let consentComplete = true;
vi.mock('../legal/CheckoutConsent', () => ({
  default: () => null,
  useConsentComplete: () => consentComplete,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, arg?: any) =>
      arg && typeof arg === 'object' && Object.keys(arg).length
        ? `${key}::${Object.values(arg).join(',')}`
        : key,
  }),
}));

const product = (over: Partial<any> = {}) => ({
  code: 'module_personnel',
  name: 'Personel Yönetimi',
  description: null,
  kind: 'module',
  billing: 'annual',
  priceCents: 99_000,
  currency: 'TRY',
  creditKind: null,
  creditUnits: null,
  requiresLicense: true,
  sortOrder: 0,
  ...over,
});

const LICENCE = product({
  code: 'license_annual',
  name: 'Bakım, Destek ve Güncelleme',
  kind: 'license',
  priceCents: 299_000,
  requiresLicense: false,
});

/** The row's checkbox is labelled with the product name. */
const tick = (name: string) =>
  fireEvent.click(screen.getByRole('checkbox', { name }));

const bill = () => document.getElementById('catalog-bill') as HTMLElement;

/**
 * The total, specifically. A single-line bill shows the same figure twice (the
 * line and the total), so an unscoped text query is ambiguous — and asserting
 * on the line would not prove the total was summed at all.
 */
const total = () =>
  within(bill()).getByText('licensing:store.total').parentElement as HTMLElement;

beforeEach(() => {
  purchaseAsync.mockReset().mockResolvedValue({});
  consentComplete = true;
  licenseStatus = 'active';
  owned = [];
  offers = {};
  purchasability = {};
  products = [LICENCE, product()];
});

describe('CatalogStore — building the bill', () => {
  it('starts empty and refuses to pay', () => {
    render(<CatalogStore />);
    expect(within(bill()).getByText('licensing:store.billEmpty')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /store\.payTotal/ }));
    expect(purchaseAsync).not.toHaveBeenCalled();
  });

  it('adds a ticked line to the bill and totals it', () => {
    render(<CatalogStore />);
    tick('Personel Yönetimi');

    expect(within(bill()).getByText('Personel Yönetimi')).toBeInTheDocument();
    expect(within(total()).getByText('₺990,00')).toBeInTheDocument();
  });

  it('unticking takes it back off', () => {
    render(<CatalogStore />);
    tick('Personel Yönetimi');
    tick('Personel Yönetimi');
    expect(within(bill()).getByText('licensing:store.billEmpty')).toBeInTheDocument();
  });

  it('totals the PRORATED price, not the list price', () => {
    // The whole point of the two-number display: a module bought two months
    // before the anniversary costs a sixth of its annual price today.
    offers = {
      'feature.personnelManagement': {
        code: 'module_personnel',
        proratedCents: 16_500,
        periodEnd: '2027-03-10T00:00:00.000Z',
      },
    };
    render(<CatalogStore />);
    tick('Personel Yönetimi');

    expect(within(total()).getByText('₺165,00')).toBeInTheDocument();
    // …and still says what it renews at, so next year is not a surprise.
    expect(
      within(bill()).getByText('licensing:store.renewalNote::₺990,00'),
    ).toBeInTheDocument();
  });

  it('pays for every line at once, with the consent ids', async () => {
    render(<CatalogStore />);
    tick('Personel Yönetimi');
    tick('Bakım, Destek ve Güncelleme');

    fireEvent.click(screen.getByRole('button', { name: /store\.payTotal/ }));
    await vi.waitFor(() => expect(purchaseAsync).toHaveBeenCalled());

    const arg = purchaseAsync.mock.calls[0][0];
    expect(arg.items).toEqual(
      expect.arrayContaining([
        { type: 'addon', code: 'module_personnel', qty: 1 },
        { type: 'addon', code: 'license_annual', qty: 1 },
      ]),
    );
    expect(arg.items).toHaveLength(2);
    expect(arg).toHaveProperty('acceptedDocumentIds');
  });

  it('will not pay without consent', () => {
    consentComplete = false;
    render(<CatalogStore />);
    tick('Personel Yönetimi');

    const payButton = screen.getByRole('button', { name: /store\.payTotal/ });
    expect(payButton).toBeDisabled();
    fireEvent.click(payButton);
    expect(purchaseAsync).not.toHaveBeenCalled();
  });
});

describe('CatalogStore — the licence prerequisite', () => {
  beforeEach(() => {
    licenseStatus = 'none';
  });

  it('adds the licence to the bill when a gated line is ticked', () => {
    // The server rejects a licence-gated line without one. Letting the customer
    // find that out at the payment page would be hostile, so it goes on the
    // bill as a visible line rather than a surprise on the receipt.
    render(<CatalogStore />);
    tick('Personel Yönetimi');

    expect(within(bill()).getByText('Bakım, Destek ve Güncelleme')).toBeInTheDocument();
    // 990 + 2990
    expect(within(bill()).getByText('₺3.980,00')).toBeInTheDocument();
  });

  it('does not double-charge when the licence is also ticked by hand', () => {
    render(<CatalogStore />);
    tick('Bakım, Destek ve Güncelleme');
    tick('Personel Yönetimi');

    fireEvent.click(screen.getByRole('button', { name: /store\.payTotal/ }));
    const codes = purchaseAsync.mock.calls[0][0].items.map((i: any) => i.code);
    expect(codes.filter((c: string) => c === 'license_annual')).toHaveLength(1);
  });

  it('leaves the licence off when nothing on the bill needs it', () => {
    products = [LICENCE, product({ code: 'credit_ai_photo_100', name: 'AI Kontör', kind: 'credit', billing: 'oneTime', priceCents: 69_000, requiresLicense: false })];
    render(<CatalogStore />);
    tick('AI Kontör');

    expect(within(bill()).queryByText('Bakım, Destek ve Güncelleme')).not.toBeInTheDocument();
  });

  it('does not re-add a licence the tenant already holds', () => {
    licenseStatus = 'active';
    render(<CatalogStore />);
    tick('Personel Yönetimi');
    expect(within(bill()).queryByText('Bakım, Destek ve Güncelleme')).not.toBeInTheDocument();
  });

  it('does not re-add a licence that is inside its grace window', () => {
    // Grace means the licence is still LIVE. Adding a second one produces a
    // basket checkout refuses as already-owned, killing the whole purchase.
    licenseStatus = 'grace';
    render(<CatalogStore />);
    tick('Personel Yönetimi');

    expect(within(bill()).queryByText('Bakım, Destek ve Güncelleme')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /store\.payTotal/ }));
    const codes = purchaseAsync.mock.calls[0][0].items.map((i: any) => i.code);
    expect(codes).toEqual(['module_personnel']);
  });
});

describe('CatalogStore — quantities and ownership', () => {
  it('offers a stepper for repeatable products only', () => {
    products = [
      product({ code: 'extra_branch', name: 'Ek Şube', kind: 'capacity', priceCents: 399_000 }),
      product(),
    ];
    render(<CatalogStore />);

    tick('Personel Yönetimi');
    expect(screen.queryByRole('button', { name: 'licensing:store.increase' })).toBeNull();

    tick('Ek Şube');
    expect(screen.getByRole('button', { name: 'licensing:store.increase' })).toBeInTheDocument();
  });

  it('multiplies the line by its quantity', async () => {
    products = [product({ code: 'extra_branch', name: 'Ek Şube', kind: 'capacity', priceCents: 399_000 })];
    render(<CatalogStore />);
    tick('Ek Şube');

    fireEvent.click(screen.getByRole('button', { name: 'licensing:store.increase' }));
    fireEvent.click(screen.getByRole('button', { name: 'licensing:store.increase' }));

    expect(within(total()).getByText('₺11.970,00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /store\.payTotal/ }));
    await vi.waitFor(() => expect(purchaseAsync).toHaveBeenCalled());
    expect(purchaseAsync.mock.calls[0][0].items[0]).toEqual({
      type: 'addon',
      code: 'extra_branch',
      qty: 3,
    });
  });

  it('stepping the quantity does not untick the line', () => {
    // The stepper sits inside the row's <label>, so without preventDefault the
    // browser forwards every +/- click to the checkbox and the line vanishes
    // mid-edit.
    products = [product({ code: 'extra_branch', name: 'Ek Şube', kind: 'capacity', priceCents: 399_000 })];
    render(<CatalogStore />);
    tick('Ek Şube');

    fireEvent.click(screen.getByRole('button', { name: 'licensing:store.increase' }));

    expect(screen.getByRole('checkbox', { name: 'Ek Şube' })).toBeChecked();
    expect(within(total()).getByText('₺7.980,00')).toBeInTheDocument();
  });

  it('never floors the quantity below one', () => {
    products = [product({ code: 'extra_branch', name: 'Ek Şube', kind: 'capacity', priceCents: 399_000 })];
    render(<CatalogStore />);
    tick('Ek Şube');
    expect(screen.getByRole('button', { name: 'licensing:store.decrease' })).toBeDisabled();
  });

  it('shows an owned module as owned and refuses to re-sell it', () => {
    purchasability = {
      module_personnel: { ok: false, reason: 'ADDON_ALREADY_OWNED' },
    };
    render(<CatalogStore />);

    expect(screen.getByRole('checkbox', { name: 'Personel Yönetimi' })).toBeDisabled();
    expect(screen.getByText('licensing:store.owned')).toBeInTheDocument();
  });

  it('refuses to re-sell a capability granted WITHOUT an ownership row', () => {
    // The bug a demo visitor hit: the demo's features come from operator
    // overrides, so no ownership row exists and the store cheerfully offered
    // everything it already had. Checkout then refused the cart with
    // ADDON_ALREADY_GRANTED — and because one bad line fails the whole basket,
    // the product they DID want failed with it.
    owned = [];
    purchasability = {
      module_personnel: { ok: false, reason: 'ADDON_ALREADY_GRANTED' },
    };
    render(<CatalogStore />);

    expect(screen.getByRole('checkbox', { name: 'Personel Yönetimi' })).toBeDisabled();
  });

  it('says "max reached" rather than "owned" when capacity is capped', () => {
    products = [product({ code: 'extra_branch', name: 'Ek Şube', kind: 'capacity', priceCents: 399000 })];
    purchasability = { extra_branch: { ok: false, reason: 'ADDON_MAX_QUANTITY' } };
    render(<CatalogStore />);

    expect(screen.getByText('licensing:store.maxReached')).toBeInTheDocument();
  });

  it('still offers a licence-gated product to a tenant with no licence', () => {
    // LICENSE_REQUIRED is not a refusal to sell — the store adds the licence
    // itself. Treating it as one would grey out the entire catalogue for every
    // tenant who has not bought yet.
    licenseStatus = 'none';
    purchasability = {
      module_personnel: { ok: false, reason: 'LICENSE_REQUIRED' },
    };
    render(<CatalogStore />);

    expect(screen.getByRole('checkbox', { name: 'Personel Yönetimi' })).not.toBeDisabled();
  });

  it('still sells a repeatable product the tenant already owns', () => {
    // Owning one extra branch must not stop them buying a second.
    products = [product({ code: 'extra_branch', name: 'Ek Şube', kind: 'capacity', priceCents: 399_000 })];
    owned = [{ code: 'extra_branch', status: 'active' }];
    render(<CatalogStore />);

    expect(screen.getByRole('checkbox', { name: 'Ek Şube' })).not.toBeDisabled();
  });
});

describe('CatalogStore — the mobile bill bar', () => {
  // jsdom applies no media queries, so both the aside button and the sticky
  // bar are in the tree; they are told apart by label.
  const mobileButton = () =>
    screen.getByRole('button', { name: /store\.(pay|reviewBill)$/ });

  it('shows the running total once something is ticked', () => {
    render(<CatalogStore />);
    expect(screen.queryByText('licensing:store.selectedCount::1')).toBeNull();

    tick('Personel Yönetimi');
    expect(screen.getByText('licensing:store.selectedCount::1')).toBeInTheDocument();
  });

  it('pays from the bar when consent is in', async () => {
    render(<CatalogStore />);
    tick('Personel Yönetimi');
    fireEvent.click(mobileButton());
    await vi.waitFor(() => expect(purchaseAsync).toHaveBeenCalled());
  });

  it('sends the buyer to the bill instead of paying when consent is missing', () => {
    // The consent checkboxes live in the bill, which on a phone is far below.
    // A disabled button with no explanation is a dead end; this is the money
    // guard AND the way out of it.
    consentComplete = false;
    const scrollIntoView = vi.fn();
    render(<CatalogStore />);
    tick('Personel Yönetimi');
    (document.getElementById('catalog-bill') as HTMLElement).scrollIntoView =
      scrollIntoView;

    fireEvent.click(mobileButton());

    expect(purchaseAsync).not.toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenCalled();
  });
});

describe('CatalogStore — arriving from an upsell', () => {
  it('pre-ticks the product the customer was sent here to buy', () => {
    render(<CatalogStore focusCode="module_personnel" />);
    expect(screen.getByRole('checkbox', { name: 'Personel Yönetimi' })).toBeChecked();
    expect(within(bill()).getByText('Personel Yönetimi')).toBeInTheDocument();
  });

  it('does not pre-tick something already owned', () => {
    purchasability = {
      module_personnel: { ok: false, reason: 'ADDON_ALREADY_OWNED' },
    };
    render(<CatalogStore focusCode="module_personnel" />);
    expect(within(bill()).getByText('licensing:store.billEmpty')).toBeInTheDocument();
  });
});
