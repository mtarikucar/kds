import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MarketplaceAdminPage from './MarketplaceAdminPage';

const archiveAddOnMutate = vi.fn();
const updateAddOnMutate = vi.fn();
const updateAddOnAsync = vi.fn().mockResolvedValue({});
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
  useSaUpdateAddOn: () => ({ mutate: updateAddOnMutate, mutateAsync: updateAddOnAsync }),
  useSaArchiveAddOn: () => ({ mutate: archiveAddOnMutate }),
  useSaListProducts: () => ({ data: products, isLoading: false }),
  useSaCreateProduct: () => ({ mutateAsync: createProductAsync }),
  useSaUpdateProduct: () => ({ mutate: updateProductMutate }),
  useSaArchiveProduct: () => ({ mutate: archiveProductMutate }),
  useSaReceiveStock: () => ({ mutate: receiveStockMutate }),
  // Vocabulary constants are plain data — the editor renders its selects from
  // them, so the mock has to carry them or every field disappears.
  ADDON_KINDS: ['license', 'module', 'integration', 'capacity', 'credit', 'service'],
  ADDON_BILLINGS: ['annual', 'oneTime'],
  CREDIT_KINDS: ['PHOTO', 'VIDEO', 'MODEL3D', 'SMS'],
  CATALOG_LOCALES: ['tr', 'en', 'ar', 'ru', 'uz'],
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

describe('MarketplaceAdminPage — à-la-carte editor invariants', () => {
  beforeEach(() => {
    createAddOnAsync.mockClear();
    addons = [];
    products = [];
  });
  afterEach(() => vi.restoreAllMocks());

  function openEditor() {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.addons.new' }));
  }

  function field(label: string) {
    const wrap = screen.getByText(label).closest('label') as HTMLElement;
    return wrap;
  }

  function setKind(kind: string) {
    const wrap = field('marketplace.addons.fields.kind');
    fireEvent.change(within(wrap).getByRole('combobox'), { target: { value: kind } });
  }

  function setPrice(cents: number) {
    const wrap = field('marketplace.addons.fields.priceCents');
    fireEvent.change(within(wrap).getByRole('spinbutton'), { target: { value: String(cents) } });
  }

  function setStatus(status: string) {
    const wrap = field('marketplace.addons.fields.status');
    fireEvent.change(within(wrap).getByRole('combobox'), { target: { value: status } });
  }

  const submit = () =>
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.addons.create' }));

  it('defaults a new product to annual, licence-gated', async () => {
    // The pre-v3.3.0 form defaulted to `recurring`, a cadence the pricer now
    // refuses — a new product created from the old defaults was unsellable.
    openEditor();
    const billing = within(field('marketplace.addons.fields.billing')).getByRole(
      'combobox',
    ) as HTMLSelectElement;
    expect(billing.value).toBe('annual');

    const codeWrap = field('marketplace.addons.fields.code');
    fireEvent.change(within(codeWrap).getByRole('textbox'), { target: { value: 'module_x' } });
    setPrice(129000);
    submit();

    await waitFor(() => expect(createAddOnAsync).toHaveBeenCalled());
    expect(createAddOnAsync.mock.calls[0][0]).toMatchObject({
      billing: 'annual',
      requiresLicense: true,
    });
  });

  it('flips a credit pack to oneTime and demands kind + units', async () => {
    openEditor();
    setKind('credit');

    const billing = within(field('marketplace.addons.fields.billing')).getByRole(
      'combobox',
    ) as HTMLSelectElement;
    expect(billing.value).toBe('oneTime');

    fireEvent.change(
      within(field('marketplace.addons.fields.code')).getByRole('textbox'),
      { target: { value: 'credit_x' } },
    );
    setPrice(69000);
    submit();
    expect(await screen.findByText('marketplace.addons.creditIncomplete')).toBeInTheDocument();
    expect(createAddOnAsync).not.toHaveBeenCalled();

    fireEvent.change(
      within(field('marketplace.addons.fields.creditKind')).getByRole('combobox'),
      { target: { value: 'PHOTO' } },
    );
    fireEvent.change(
      within(field('marketplace.addons.fields.creditUnits')).getByRole('spinbutton'),
      { target: { value: '100' } },
    );
    submit();
    await waitFor(() => expect(createAddOnAsync).toHaveBeenCalled());
    expect(createAddOnAsync.mock.calls[0][0]).toMatchObject({
      creditKind: 'PHOTO',
      creditUnits: 100,
      billing: 'oneTime',
    });
  });

  it('refuses to publish a free product', async () => {
    // A published zero-price row is a giveaway: checkout provisions it without
    // any payment at all, because purchase() only demands a paymentRef when
    // priceCents > 0.
    openEditor();
    fireEvent.change(
      within(field('marketplace.addons.fields.code')).getByRole('textbox'),
      { target: { value: 'module_free' } },
    );
    setStatus('published');
    submit();
    expect(
      await screen.findByText('marketplace.addons.publishedNeedsPrice'),
    ).toBeInTheDocument();
    expect(createAddOnAsync).not.toHaveBeenCalled();
  });

  it('clears requiresLicense when the product IS the licence', () => {
    // A licence that requires a licence can never be bought — the projector
    // would suppress the very grant that unsuppresses everything.
    openEditor();
    setKind('license');
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toBeDisabled();
  });

  it('rejects a plan: dependency left over from the tier era', async () => {
    openEditor();
    fireEvent.change(
      within(field('marketplace.addons.fields.code')).getByRole('textbox'),
      { target: { value: 'module_y' } },
    );
    setPrice(99000);
    fireEvent.change(
      within(field('marketplace.addons.fields.deps')).getByRole('textbox'),
      { target: { value: 'plan:PRO' } },
    );
    submit();
    expect(await screen.findByText('marketplace.addons.planDepsGone')).toBeInTheDocument();
    expect(createAddOnAsync).not.toHaveBeenCalled();
  });

  it('sends localized copy so a product ships without a frontend release', async () => {
    openEditor();
    fireEvent.change(
      within(field('marketplace.addons.fields.code')).getByRole('textbox'),
      { target: { value: 'module_z' } },
    );
    setPrice(99000);

    const trRow = screen.getByText('tr').parentElement as HTMLElement;
    const [nameInput] = within(trRow).getAllByRole('textbox');
    fireEvent.change(nameInput, { target: { value: 'Personel Yönetimi' } });

    submit();
    await waitFor(() => expect(createAddOnAsync).toHaveBeenCalled());
    expect(createAddOnAsync.mock.calls[0][0].i18n).toMatchObject({
      tr: { name: 'Personel Yönetimi' },
    });
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

  it('F5: a FAILED create keeps the editor modal open (input preserved)', async () => {
    createAddOnAsync.mockRejectedValueOnce(new Error('409 dup code'));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.addons.new' }));

    const codeWrap = screen.getByText('marketplace.addons.fields.code').closest('label') as HTMLElement;
    fireEvent.change(within(codeWrap).getByRole('textbox'), { target: { value: 'kds_dup' } });
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.addons.create' }));

    await vi.waitFor(() => expect(createAddOnAsync).toHaveBeenCalledTimes(1));
    // Modal is still open (title present) and the typed code is preserved.
    expect(screen.getByText('marketplace.addons.newTitle')).toBeInTheDocument();
    expect((within(codeWrap).getByRole('textbox') as HTMLInputElement).value).toBe('kds_dup');
  });

  it('F5: a FAILED edit keeps the editor modal open', async () => {
    addons = [addon({ id: 'a-edit', status: 'draft' })];
    updateAddOnAsync.mockRejectedValueOnce(new Error('500'));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.addons.edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.addons.save' }));

    await vi.waitFor(() => expect(updateAddOnAsync).toHaveBeenCalledTimes(1));
    expect(screen.getByText('marketplace.addons.editTitle')).toBeInTheDocument();
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

  it('offers the service category in the product form select', async () => {
    // Bu seçenek olmadan iki print3d satırı panelden HİÇ oluşturulamaz:
    // form `category` alanını gönderiyor ve <select> 'service' sunmuyordu.
    renderPage();
    switchToProductsTab();
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.products.new' }));
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => (o as HTMLOptionElement).value)).toContain('service');
  });
});
