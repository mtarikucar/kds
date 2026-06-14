import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MarketplaceAdminPage from './MarketplaceAdminPage';

const archiveAddOnMutate = vi.fn();
const updateAddOnMutate = vi.fn();
const createAddOnAsync = vi.fn().mockResolvedValue({});
const archiveProductMutate = vi.fn();
const updateProductMutate = vi.fn();
const receiveStockMutate = vi.fn();
const createProductAsync = vi.fn().mockResolvedValue({});

let addons: any[];
let products: any[];

vi.mock('../../features/superadmin/api/superadminMarketplaceApi', () => ({
  useSaListAddOns: () => ({ data: addons, isLoading: false }),
  useSaCreateAddOn: () => ({ mutateAsync: createAddOnAsync }),
  useSaUpdateAddOn: () => ({ mutate: updateAddOnMutate, mutateAsync: vi.fn().mockResolvedValue({}) }),
  useSaArchiveAddOn: () => ({ mutate: archiveAddOnMutate }),
  useSaListProducts: () => ({ data: products, isLoading: false }),
  useSaCreateProduct: () => ({ mutateAsync: createProductAsync }),
  useSaUpdateProduct: () => ({ mutate: updateProductMutate }),
  useSaArchiveProduct: () => ({ mutate: archiveProductMutate }),
  useSaReceiveStock: () => ({ mutate: receiveStockMutate }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, arg?: any) => {
      if (arg && typeof arg === 'object' && Object.keys(arg).length) {
        return `${key}::${Object.values(arg).join(',')}`;
      }
      return key;
    },
  }),
}));

function addon(over: Partial<any> = {}) {
  return {
    id: 'a1',
    code: 'kds_extra_screen',
    name: 'Extra Screen',
    description: null,
    kind: 'capacity',
    billing: 'recurring',
    priceCents: 4900,
    currency: 'TRY',
    grants: { screens: 1 },
    deps: [],
    status: 'published',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...over,
  };
}

function product(over: Partial<any> = {}) {
  return {
    id: 'pr1',
    sku: 'KDS-15',
    category: 'kds_screen',
    name: 'KDS 15"',
    brand: null,
    model: null,
    description: null,
    priceCents: 120000,
    rentalMonthlyCents: null,
    currency: 'TRY',
    warrantyMonths: 24,
    images: [],
    stockStatus: 'in_stock',
    status: 'published',
    inventory: { available: 5, allocated: 0, shipped: 0 },
    ...over,
  };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MarketplaceAdminPage />
    </QueryClientProvider>,
  );
}

describe('MarketplaceAdminPage — add-on archive flow', () => {
  beforeEach(() => {
    archiveAddOnMutate.mockReset();
    updateAddOnMutate.mockReset();
    addons = [addon({ id: 'arch-me', code: 'kds_extra_screen', status: 'published' })];
    products = [];
  });
  afterEach(() => vi.restoreAllMocks());

  it('confirms then archives the add-on by id', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.addons.archive' }));
    expect(window.confirm).toHaveBeenCalledWith('marketplace.addons.confirmArchive::kds_extra_screen');
    expect(archiveAddOnMutate).toHaveBeenCalledWith('arch-me');
  });

  it('does NOT archive when confirm is declined', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.addons.archive' }));
    expect(archiveAddOnMutate).not.toHaveBeenCalled();
  });

  it('publish action (for a non-published add-on) updates status to published — no confirm', () => {
    addons = [addon({ id: 'draft-1', status: 'draft' })];
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.addons.publish' }));
    expect(updateAddOnMutate).toHaveBeenCalledWith({ id: 'draft-1', status: 'published' });
  });
});

describe('MarketplaceAdminPage — add-on editor grants JSON parse', () => {
  beforeEach(() => {
    createAddOnAsync.mockClear();
    addons = [];
    products = [];
  });
  afterEach(() => vi.restoreAllMocks());

  it('rejects invalid grants JSON with an inline error and does not submit', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.addons.new' }));

    const grantsWrap = screen.getByText('marketplace.addons.fields.grants').closest('label') as HTMLElement;
    const grantsArea = within(grantsWrap).getByRole('textbox');
    fireEvent.change(grantsArea, { target: { value: '{ not valid json' } });

    fireEvent.click(screen.getByRole('button', { name: 'marketplace.addons.create' }));

    expect(await screen.findByText('marketplace.addons.grantsInvalid')).toBeInTheDocument();
    expect(createAddOnAsync).not.toHaveBeenCalled();
  });

  it('parses valid grants JSON and submits create() with the parsed object', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.addons.new' }));

    // code field (disabled when editing; enabled for create)
    const codeWrap = screen.getByText('marketplace.addons.fields.code').closest('label') as HTMLElement;
    fireEvent.change(within(codeWrap).getByRole('textbox'), { target: { value: 'kds_new' } });

    const grantsWrap = screen.getByText('marketplace.addons.fields.grants').closest('label') as HTMLElement;
    fireEvent.change(within(grantsWrap).getByRole('textbox'), { target: { value: '{"screens": 2}' } });

    fireEvent.click(screen.getByRole('button', { name: 'marketplace.addons.create' }));

    await vi.waitFor(() => expect(createAddOnAsync).toHaveBeenCalledTimes(1));
    const body = createAddOnAsync.mock.calls[0][0];
    expect(body).toMatchObject({ code: 'kds_new', grants: { screens: 2 } });
  });
});

describe('MarketplaceAdminPage — product receive-stock & archive', () => {
  beforeEach(() => {
    receiveStockMutate.mockReset();
    archiveProductMutate.mockReset();
    addons = [];
    products = [product({ id: 'prod-9', sku: 'KDS-15', status: 'published' })];
  });
  afterEach(() => vi.restoreAllMocks());

  function switchToProductsTab() {
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.tabHardware' }));
  }

  it('receives stock for a valid positive integer prompt', () => {
    vi.spyOn(window, 'prompt').mockReturnValue('12');
    renderPage();
    switchToProductsTab();
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.products.receiveStock' }));
    expect(receiveStockMutate).toHaveBeenCalledWith({ id: 'prod-9', qty: 12 });
  });

  it('does NOT receive stock when the prompt is non-numeric', () => {
    vi.spyOn(window, 'prompt').mockReturnValue('lots');
    renderPage();
    switchToProductsTab();
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.products.receiveStock' }));
    expect(receiveStockMutate).not.toHaveBeenCalled();
  });

  it('does NOT receive stock when the prompt is below 1', () => {
    vi.spyOn(window, 'prompt').mockReturnValue('0');
    renderPage();
    switchToProductsTab();
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.products.receiveStock' }));
    expect(receiveStockMutate).not.toHaveBeenCalled();
  });

  it('does NOT receive stock when the prompt is cancelled (null)', () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    renderPage();
    switchToProductsTab();
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.products.receiveStock' }));
    expect(receiveStockMutate).not.toHaveBeenCalled();
  });

  it('confirms then archives the product by id', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    switchToProductsTab();
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.products.archive' }));
    expect(window.confirm).toHaveBeenCalledWith('marketplace.products.confirmArchive::KDS-15');
    expect(archiveProductMutate).toHaveBeenCalledWith('prod-9');
  });
});
