import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MarketplacePage from './MarketplacePage';
import type { MarketplaceAddOn, TenantAddOn } from './marketplaceApi';

// --- mocks --------------------------------------------------------------

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let lastKind: string | undefined = undefined;
let catalog: MarketplaceAddOn[] = [];
let catalogLoading = false;
let mine: TenantAddOn[] = [];
const purchaseMutate = vi.fn();
const cancelMutate = vi.fn();
let purchasePending = false;

vi.mock('./marketplaceApi', () => ({
  useListAddOns: (kind?: string) => {
    lastKind = kind;
    return { data: catalog, isLoading: catalogLoading };
  },
  useListMyAddOns: () => ({ data: mine }),
  usePurchaseAddOnViaCheckout: () => ({ mutate: purchaseMutate, isPending: purchasePending }),
  useCancelAddOn: () => ({ mutate: cancelMutate }),
}));

const addon = (over: Partial<MarketplaceAddOn>): MarketplaceAddOn => ({
  code: 'a',
  name: 'Add-On A',
  description: 'desc',
  kind: 'software',
  billing: 'oneTime',
  priceCents: 1000,
  currency: 'TRY',
  deps: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  lastKind = undefined;
  catalog = [];
  catalogLoading = false;
  mine = [];
  purchasePending = false;
});

describe('MarketplacePage catalogue rendering', () => {
  it('shows a loading message and no cards while the catalogue is loading', () => {
    catalogLoading = true;
    render(<MemoryRouter><MarketplacePage /></MemoryRouter>);
    expect(screen.getByText('hummytummy.common.loading')).toBeInTheDocument();
  });

  it('renders a dependency hint only for add-ons that declare deps', () => {
    catalog = [
      addon({ code: 'free', name: 'Free One', deps: [] }),
      addon({ code: 'dep', name: 'Needs Stuff', deps: ['software.pos', 'integration.x'] }),
    ];
    render(<MemoryRouter><MarketplacePage /></MemoryRouter>);

    const depCard = screen.getByText('Needs Stuff').closest('article') as HTMLElement;
    expect(within(depCard).getByText(/software.pos, integration.x/)).toBeInTheDocument();

    const freeCard = screen.getByText('Free One').closest('article') as HTMLElement;
    expect(within(freeCard).queryByText('hummytummy.marketplace.requires')).not.toBeInTheDocument();
  });

  it('marks a plan-included add-on as included and hides its purchase button', () => {
    catalog = [
      addon({ code: 'reservation', name: 'Reservation system', includedInPlan: true }),
      addon({ code: 'buyable', name: 'Buyable Thing', includedInPlan: false }),
    ];
    render(<MemoryRouter><MarketplacePage /></MemoryRouter>);

    const includedCard = screen.getByText('Reservation system').closest('article') as HTMLElement;
    // Shows the "included in your plan" marker and offers NO purchase button.
    expect(
      within(includedCard).getAllByText('hummytummy.marketplace.includedInPlan').length,
    ).toBeGreaterThan(0);
    expect(
      within(includedCard).queryByText('hummytummy.marketplace.purchase'),
    ).not.toBeInTheDocument();

    // A normal add-on still shows the purchase button.
    const buyCard = screen.getByText('Buyable Thing').closest('article') as HTMLElement;
    expect(
      within(buyCard).getByText('hummytummy.marketplace.purchase'),
    ).toBeInTheDocument();
  });

  it('formats price in the add-on currency and appends "/ mo" only for recurring billing', () => {
    catalog = [
      addon({ code: 'once', name: 'One Time', priceCents: 9900, currency: 'TRY', billing: 'oneTime' }),
      addon({ code: 'sub', name: 'Monthly', priceCents: 4900, currency: 'TRY', billing: 'recurring' }),
    ];
    render(<MemoryRouter><MarketplacePage /></MemoryRouter>);

    const onceCard = screen.getByText('One Time').closest('article') as HTMLElement;
    // 9900 cents → 99,00 ₺ (tr-TR currency formatting); no "/ mo" suffix.
    expect(within(onceCard).queryByText('/ mo')).not.toBeInTheDocument();

    const subCard = screen.getByText('Monthly').closest('article') as HTMLElement;
    expect(within(subCard).getByText('/ mo')).toBeInTheDocument();
  });
});

describe('MarketplacePage kind filter', () => {
  it('passes the chosen kind to the catalogue query and re-queries with undefined for "all"', () => {
    catalog = [addon({})];
    render(<MemoryRouter><MarketplacePage /></MemoryRouter>);
    // Default selection is "all" → kind undefined.
    expect(lastKind).toBeUndefined();

    fireEvent.click(screen.getByText('hummytummy.marketplace.filter.integration'));
    expect(lastKind).toBe('integration');

    fireEvent.click(screen.getByText('hummytummy.marketplace.filter.all'));
    expect(lastKind).toBeUndefined();
  });
});

describe('MarketplacePage purchase', () => {
  it('starts a paid checkout for the add-on after the confirm prompt', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    catalog = [addon({ code: 'pos-pro', name: 'POS Pro' })];
    render(<MemoryRouter><MarketplacePage /></MemoryRouter>);

    const card = screen.getByText('POS Pro').closest('article') as HTMLElement;
    fireEvent.click(within(card).getByText('hummytummy.marketplace.purchase'));
    expect(confirmSpy).toHaveBeenCalled();
    expect(purchaseMutate).toHaveBeenCalledWith({ addOnCode: 'pos-pro' });
    confirmSpy.mockRestore();
  });

  it('does not start checkout if the confirm prompt is cancelled', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    catalog = [addon({ code: 'pos-pro', name: 'POS Pro' })];
    render(<MemoryRouter><MarketplacePage /></MemoryRouter>);

    const card = screen.getByText('POS Pro').closest('article') as HTMLElement;
    fireEvent.click(within(card).getByText('hummytummy.marketplace.purchase'));
    expect(purchaseMutate).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('disables the purchase button while a purchase is in flight', () => {
    purchasePending = true;
    catalog = [addon({ code: 'pos-pro', name: 'POS Pro' })];
    render(<MemoryRouter><MarketplacePage /></MemoryRouter>);

    const card = screen.getByText('POS Pro').closest('article') as HTMLElement;
    expect(within(card).getByText('hummytummy.marketplace.purchase')).toBeDisabled();
  });
});

describe('MarketplacePage "your add-ons" table', () => {
  const owned = (over: Partial<TenantAddOn>): TenantAddOn => ({
    id: 't1',
    tenantId: 'ten',
    addOnId: 'a',
    branchId: null,
    quantity: 1,
    status: 'active',
    activatedAt: '2026-01-01',
    currentPeriodEnd: '2026-12-31T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    addOn: { ...addon({}), id: 'a' },
    ...over,
  });

  it('shows the empty message when the tenant owns nothing', () => {
    mine = [];
    render(<MemoryRouter><MarketplacePage /></MemoryRouter>);
    expect(screen.getByText('hummytummy.marketplace.mineEmpty')).toBeInTheDocument();
  });

  it('renders a Cancel action only for active rows', () => {
    mine = [
      owned({ id: 'active1', status: 'active', addOn: { ...addon({ name: 'Active AO' }), id: 'a' } }),
      owned({ id: 'expired1', status: 'expired', addOn: { ...addon({ name: 'Expired AO' }), id: 'b' } }),
    ];
    render(<MemoryRouter><MarketplacePage /></MemoryRouter>);

    const activeRow = screen.getByText('Active AO').closest('tr') as HTMLElement;
    expect(within(activeRow).getByText('hummytummy.common.cancel')).toBeInTheDocument();

    const expiredRow = screen.getByText('Expired AO').closest('tr') as HTMLElement;
    expect(within(expiredRow).queryByText('hummytummy.common.cancel')).not.toBeInTheDocument();
  });

  it('cancels by row id on click', () => {
    mine = [owned({ id: 'row-9', status: 'active', addOn: { ...addon({ name: 'Cancel Me' }), id: 'a' } })];
    render(<MemoryRouter><MarketplacePage /></MemoryRouter>);

    const row = screen.getByText('Cancel Me').closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByText('hummytummy.common.cancel'));
    expect(cancelMutate).toHaveBeenCalledWith({ id: 'row-9' });
  });

  it('flags rows scheduled to cancel at period end', () => {
    mine = [owned({ id: 'r', cancelAtPeriodEnd: true, addOn: { ...addon({ name: 'Ending' }), id: 'a' } })];
    render(<MemoryRouter><MarketplacePage /></MemoryRouter>);
    const row = screen.getByText('Ending').closest('tr') as HTMLElement;
    expect(within(row).getByText('hummytummy.marketplace.cancelAtPeriodEnd')).toBeInTheDocument();
  });

  it('renders an em-dash for rows without a current period end', () => {
    mine = [owned({ id: 'r', currentPeriodEnd: null, addOn: { ...addon({ name: 'NoEnd' }), id: 'a' } })];
    render(<MemoryRouter><MarketplacePage /></MemoryRouter>);
    const row = screen.getByText('NoEnd').closest('tr') as HTMLElement;
    expect(within(row).getByText('—')).toBeInTheDocument();
  });
});
