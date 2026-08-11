import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TenantDetailPage from './TenantDetailPage';

// ── api-hook mocks ───────────────────────────────────────────────────────
const updateStatusMutate = vi.fn();
const compMutate = vi.fn();
const revokeCompMutate = vi.fn();
const updateOverridesMutate = vi.fn();
const resetOverridesMutate = vi.fn();

let tenant: any;
let overridesData: any;
let licensing: any;
let catalogAddOns: any;

vi.mock('../../features/superadmin/api/superAdminApi', () => ({
  useTenant: () => ({ data: tenant, isLoading: false }),
  useTenantUsers: () => ({ data: { data: [] } }),
  useTenantOrders: () => ({ data: { data: [] } }),
  useTenantStats: () => ({ data: { revenue: { total: 0 }, orders: { today: 0, thisMonth: 0 } } }),
  useTenantOverrides: () => ({ data: overridesData }),
  useUpdateTenantStatus: () => ({ mutate: updateStatusMutate, isPending: false }),
  useUpdateTenantOverrides: () => ({ mutate: updateOverridesMutate, isPending: false }),
  useResetTenantOverrides: () => ({ mutate: resetOverridesMutate, isPending: false }),
}));

vi.mock('../../features/superadmin/api/superadminMarketplaceApi', () => ({
  useSaTenantLicensing: () => ({ data: licensing }),
  useSaListAddOns: () => ({ data: catalogAddOns ?? [] }),
  useSaCompProduct: () => ({ mutate: compMutate, isPending: false }),
  useSaRevokeComp: () => ({ mutate: revokeCompMutate, isPending: false }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, arg?: any) => {
      // The override row labels call t(`...featureLabels.x`, FALLBACK_STRING).
      if (typeof arg === 'string') return arg;
      if (arg && typeof arg === 'object' && Object.keys(arg).length) {
        return `${key}::${Object.values(arg).join(',')}`;
      }
      return key;
    },
  }),
}));
// getApiErrorMessage imports i18n/config, which would eagerly re-init i18next
// against the partial react-i18next mock. Stub it.
vi.mock('../../i18n/config', () => ({ default: { t: (k: string) => k } }));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ id: 'tid-1' }) };
});

function baseTenant(over: Partial<any> = {}) {
  return {
    id: 'tid-1',
    name: 'Acme Diner',
    subdomain: 'acme',
    status: 'ACTIVE',
    currency: 'TRY',
    createdAt: '2026-01-02T00:00:00.000Z',
    currentPlan: { id: 'p1', name: 'PRO', displayName: 'Pro Plan' },
    subscriptions: [{ id: 'sub-1', status: 'ACTIVE', plan: { displayName: 'Pro Plan' }, billingCycle: 'MONTHLY', currentPeriodEnd: '2026-12-31T00:00:00.000Z' }],
    _count: { users: 3, products: 10, tables: 5, customers: 7 },
    ...over,
  };
}

function baseOverrides(over: Partial<any> = {}) {
  return {
    featureOverrides: {},
    limitOverrides: {},
    planDefaults: {
      features: { advancedReports: false, multiLocation: true },
      limits: { maxUsers: 5, maxTables: 10 },
    },
    effective: { features: {}, limits: {} },
    ...over,
  };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TenantDetailPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Find the override toggle button inside the row labelled by `label`.
function overrideButton(label: string) {
  const cell = screen.getByText(label);
  const row = cell.closest('tr') as HTMLElement;
  return within(row);
}

describe('TenantDetailPage — status-change modal flow (F6)', () => {
  beforeEach(() => {
    updateStatusMutate.mockReset();
    tenant = baseTenant();
    overridesData = undefined;
    licensing = undefined;
    catalogAddOns = [];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('Suspend opens a modal and sends { id, status: SUSPENDED } with the optional reason', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'tenantDetail.suspend' }));
    expect(screen.getByText('tenantDetail.suspendModal.title')).toBeInTheDocument();
    // reason is optional for suspend — confirm works without it
    fireEvent.click(screen.getByRole('button', { name: 'tenantDetail.suspendModal.confirm' }));
    expect(updateStatusMutate).toHaveBeenCalledTimes(1);
    expect(updateStatusMutate).toHaveBeenCalledWith(
      { id: 'tid-1', status: 'SUSPENDED', reason: undefined },
      expect.any(Object),
    );
  });

  it('Suspend forwards a typed reason to the DTO', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'tenantDetail.suspend' }));
    fireEvent.change(screen.getByPlaceholderText('tenantDetail.statusModal.reasonPlaceholder'), {
      target: { value: 'non-payment' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'tenantDetail.suspendModal.confirm' }));
    expect(updateStatusMutate).toHaveBeenCalledWith(
      { id: 'tid-1', status: 'SUSPENDED', reason: 'non-payment' },
      expect.any(Object),
    );
  });

  it('Delete opens the destructive modal: consequences listed, confirm disabled until reason + name typed', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'tenantDetail.delete' }));
    expect(screen.getByText('tenantDetail.deleteModal.title')).toBeInTheDocument();
    expect(screen.getByText('tenantDetail.deleteModal.consequenceSessions')).toBeInTheDocument();
    expect(screen.getByText('tenantDetail.deleteModal.consequenceSubdomain')).toBeInTheDocument();
    expect(screen.getByText('tenantDetail.deleteModal.consequenceEmail')).toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: 'tenantDetail.deleteModal.confirm' });
    expect(confirm).toBeDisabled();

    // reason alone is not enough — the tenant name must be typed back
    fireEvent.change(screen.getByPlaceholderText('tenantDetail.statusModal.reasonPlaceholder'), {
      target: { value: 'fraud' },
    });
    expect(screen.getByRole('button', { name: 'tenantDetail.deleteModal.confirm' })).toBeDisabled();

    // a WRONG name keeps it disabled
    fireEvent.change(screen.getByPlaceholderText('Acme Diner'), { target: { value: 'Other' } });
    expect(screen.getByRole('button', { name: 'tenantDetail.deleteModal.confirm' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'tenantDetail.deleteModal.confirm' }));
    expect(updateStatusMutate).not.toHaveBeenCalled();

    // exact name unlocks the destructive action; the DTO carries the reason
    fireEvent.change(screen.getByPlaceholderText('Acme Diner'), { target: { value: 'Acme Diner' } });
    fireEvent.click(screen.getByRole('button', { name: 'tenantDetail.deleteModal.confirm' }));
    expect(updateStatusMutate).toHaveBeenCalledTimes(1);
    expect(updateStatusMutate).toHaveBeenCalledWith(
      { id: 'tid-1', status: 'DELETED', reason: 'fraud' },
      expect.any(Object),
    );
  });

  it('closing the modal via Cancel fires no mutation', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'tenantDetail.delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'tenantDetail.cancel' }));
    expect(screen.queryByText('tenantDetail.deleteModal.title')).not.toBeInTheDocument();
    expect(updateStatusMutate).not.toHaveBeenCalled();
  });

  it('shows Activate (not Suspend) for a SUSPENDED tenant and sends status ACTIVE', () => {
    tenant = baseTenant({ status: 'SUSPENDED' });
    renderPage();
    expect(screen.queryByRole('button', { name: 'tenantDetail.suspend' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'tenantDetail.activate' }));
    expect(window.confirm).toHaveBeenCalledWith('tenantDetail.confirmStatusChange::ACTIVE');
    expect(updateStatusMutate).toHaveBeenCalledWith(
      { id: 'tid-1', status: 'ACTIVE' },
      expect.any(Object),
    );
  });

  it('F6: a DELETED tenant gets an Activate action (backend flip is reversible)', () => {
    tenant = baseTenant({ status: 'DELETED' });
    renderPage();
    expect(screen.queryByRole('button', { name: 'tenantDetail.delete' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'tenantDetail.activate' }));
    expect(updateStatusMutate).toHaveBeenCalledWith(
      { id: 'tid-1', status: 'ACTIVE' },
      expect.any(Object),
    );
  });

  it('renders the not-found state when the tenant is missing', () => {
    tenant = undefined;
    renderPage();
    expect(screen.getByText('tenantDetail.notFound')).toBeInTheDocument();
  });
});

describe('TenantDetailPage — feature override default→on→off cycle', () => {
  beforeEach(() => {
    updateOverridesMutate.mockReset();
    resetOverridesMutate.mockReset();
    tenant = baseTenant();
    overridesData = baseOverrides();
    licensing = undefined;
    catalogAddOns = [];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('initial state shows "default" toggle and effective = plan default', () => {
    renderPage();
    // advancedReports plan default is false → effective ✗
    const reports = overrideButton('Advanced Reports');
    expect(reports.getByText('tenantDetail.default')).toBeInTheDocument();
    expect(reports.getByText('✗')).toBeInTheDocument();

    // multiLocation plan default is true → effective ✓ even with no override
    const multi = overrideButton('Multi-Location');
    expect(multi.getByText('tenantDetail.default')).toBeInTheDocument();
    expect(multi.getByText('✓')).toBeInTheDocument();
  });

  it('clicking once forces ON: toggle label = forceOn, effective flips to ✓', () => {
    renderPage();
    const reports = overrideButton('Advanced Reports');
    // default → on
    fireEvent.click(reports.getByText('tenantDetail.default'));
    expect(overrideButton('Advanced Reports').getByText('tenantDetail.forceOn')).toBeInTheDocument();
    // even though plan default is false, forced-on wins → effective ✓
    expect(overrideButton('Advanced Reports').getByText('✓')).toBeInTheDocument();
  });

  it('clicking twice forces OFF, overriding a true plan default', () => {
    renderPage();
    // multiLocation plan default true; default → on → off
    fireEvent.click(overrideButton('Multi-Location').getByText('tenantDetail.default'));
    fireEvent.click(overrideButton('Multi-Location').getByText('tenantDetail.forceOn'));
    expect(overrideButton('Multi-Location').getByText('tenantDetail.forceOff')).toBeInTheDocument();
    // forced off wins over the true plan default → effective ✗
    expect(overrideButton('Multi-Location').getByText('✗')).toBeInTheDocument();
  });

  it('clicking three times cycles back to default', () => {
    renderPage();
    fireEvent.click(overrideButton('Advanced Reports').getByText('tenantDetail.default'));
    fireEvent.click(overrideButton('Advanced Reports').getByText('tenantDetail.forceOn'));
    fireEvent.click(overrideButton('Advanced Reports').getByText('tenantDetail.forceOff'));
    expect(overrideButton('Advanced Reports').getByText('tenantDetail.default')).toBeInTheDocument();
  });

  it('Save sends the built featureOverrides payload: on→true, off→false, untouched→null', () => {
    renderPage();
    // advancedReports → on (true)
    fireEvent.click(overrideButton('Advanced Reports').getByText('tenantDetail.default'));
    // multiLocation → on → off (false)
    fireEvent.click(overrideButton('Multi-Location').getByText('tenantDetail.default'));
    fireEvent.click(overrideButton('Multi-Location').getByText('tenantDetail.forceOn'));

    fireEvent.click(screen.getByRole('button', { name: /tenantDetail\.save/ }));

    expect(updateOverridesMutate).toHaveBeenCalledTimes(1);
    const [arg] = updateOverridesMutate.mock.calls[0];
    expect(arg.tenantId).toBe('tid-1');
    expect(arg.data.featureOverrides).toMatchObject({
      advancedReports: true,
      multiLocation: false,
      customBranding: null,
      apiAccess: null,
    });
  });

  it('Save button is disabled until an override changes', () => {
    renderPage();
    const save = screen.getByRole('button', { name: /tenantDetail\.save/ });
    expect(save).toBeDisabled();
    fireEvent.click(overrideButton('Advanced Reports').getByText('tenantDetail.default'));
    expect(screen.getByRole('button', { name: /tenantDetail\.save/ })).not.toBeDisabled();
  });

  it('limit override drives the effective value and the save payload (number vs null)', () => {
    renderPage();
    // maxUsers plan default 5; set override to 9
    const maxUsersRow = screen.getByText('Max Users').closest('tr') as HTMLElement;
    const input = within(maxUsersRow).getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '9' } });
    // effective updates to 9 (the override)
    expect(within(maxUsersRow).getByText('9')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /tenantDetail\.save/ }));
    const [arg] = updateOverridesMutate.mock.calls[0];
    expect(arg.data.limitOverrides.maxUsers).toBe(9);
    // untouched maxTables remains null (removed override)
    expect(arg.data.limitOverrides.maxTables).toBeNull();
  });

  it('F7: a FAILED save re-syncs the form from the server state (Effective stops lying)', () => {
    // Simulate a server rejection: the mutation invokes the page-level onError.
    updateOverridesMutate.mockImplementation((_vars: any, opts: any) => opts.onError(new Error('boom')));
    renderPage();

    // advancedReports (plan default false) → force ON locally: Effective shows ✓
    fireEvent.click(overrideButton('Advanced Reports').getByText('tenantDetail.default'));
    expect(overrideButton('Advanced Reports').getByText('✓')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /tenantDetail\.save/ }));

    // The save failed — the form snaps back to the persisted truth: the
    // override is gone and Effective reflects the plan default (✗) again.
    expect(overrideButton('Advanced Reports').getByText('tenantDetail.default')).toBeInTheDocument();
    expect(overrideButton('Advanced Reports').getByText('✗')).toBeInTheDocument();
    // No pending edits remain, so Save is disabled again.
    expect(screen.getByRole('button', { name: /tenantDetail\.save/ })).toBeDisabled();
  });

  it('Reset All confirms then fires resetOverrides(tenantId)', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'tenantDetail.resetAll' }));
    expect(window.confirm).toHaveBeenCalledWith('tenantDetail.confirmResetOverrides');
    expect(resetOverridesMutate).toHaveBeenCalledWith('tid-1', expect.anything());
  });

  it('seeds toggles from existing featureOverrides (true→forceOn, false→forceOff)', () => {
    overridesData = baseOverrides({
      featureOverrides: { advancedReports: true, multiLocation: false },
    });
    renderPage();
    expect(overrideButton('Advanced Reports').getByText('tenantDetail.forceOn')).toBeInTheDocument();
    expect(overrideButton('Multi-Location').getByText('tenantDetail.forceOff')).toBeInTheDocument();
  });
});

function licensingFixture(over: Partial<any> = {}) {
  return {
    tenant: { id: 'tid-1', name: 'Acme Diner' },
    license: {
      active: true,
      anchorAt: '2026-03-10T00:00:00.000Z',
      anniversaryAt: '2027-03-10T00:00:00.000Z',
      daysRemaining: 211,
    },
    owned: [],
    credits: {},
    ...over,
  };
}

describe('TenantDetailPage — comp modal', () => {
  beforeEach(() => {
    compMutate.mockReset();
    revokeCompMutate.mockReset();
    tenant = baseTenant();
    overridesData = undefined;
    licensing = licensingFixture();
    catalogAddOns = [
      { id: 'a1', code: 'license_annual', name: 'Lisans', kind: 'license', priceCents: 299000 },
      { id: 'a2', code: 'module_personnel', name: 'Personel', kind: 'module', priceCents: 99000 },
    ];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  function openModal() {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'tenantDetail.comp.action' }));
  }

  it('sends tenantId, product, quantity and reason', () => {
    openModal();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'module_personnel' } });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Pilot müşteri' } });
    fireEvent.click(screen.getByRole('button', { name: 'tenantDetail.comp.grant' }));

    expect(compMutate).toHaveBeenCalledTimes(1);
    expect(compMutate.mock.calls[0][0]).toMatchObject({
      tenantId: 'tid-1',
      addOnCode: 'module_personnel',
      quantity: 2,
      reason: 'Pilot müşteri',
    });
  });

  it('will not grant without a reason', () => {
    // The reason is what makes a comp auditable months later; an unexplained
    // giveaway is the thing this modal exists to prevent.
    openModal();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'module_personnel' } });
    const grant = screen.getByRole('button', { name: 'tenantDetail.comp.grant' });
    expect(grant).toBeDisabled();
    fireEvent.click(grant);
    expect(compMutate).not.toHaveBeenCalled();
  });

  it('warns up-front when the tenant has no licence to light the product up', () => {
    licensing = licensingFixture({
      license: { active: false, anchorAt: null, anniversaryAt: null, daysRemaining: null },
    });
    openModal();
    expect(
      screen.getByText('tenantDetail.comp.noLicenceWarning'),
    ).toBeInTheDocument();
  });
});

describe('TenantDetailPage — owned products panel', () => {
  beforeEach(() => {
    revokeCompMutate.mockReset();
    tenant = baseTenant();
    overridesData = undefined;
    catalogAddOns = [];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  const ownedRow = (over: Partial<any> = {}) => ({
    id: 'ta-1',
    code: 'module_personnel',
    name: 'Personel',
    kind: 'module',
    quantity: 1,
    status: 'active',
    origin: 'purchase',
    compReason: null,
    periodEnd: '2027-03-10T00:00:00.000Z',
    chargedCents: 99000,
    listCents: 99000,
    currency: 'TRY',
    suppressedByLicence: false,
    ...over,
  });

  it('flags a product that is owned but dark for lack of a licence', () => {
    licensing = licensingFixture({
      license: { active: false, anchorAt: null, anniversaryAt: null, daysRemaining: null },
      owned: [ownedRow({ suppressedByLicence: true })],
    });
    renderPage();
    expect(screen.getByText('tenantDetail.owned.suppressed')).toBeInTheDocument();
    expect(screen.getByText('tenantDetail.owned.darkWarning')).toBeInTheDocument();
  });

  it('offers revoke for a comp and never for a purchase', () => {
    // Taking back a purchase is a refund decision on the payment rail, not a
    // panel click — so the button must not exist for a bought product.
    licensing = licensingFixture({
      owned: [
        ownedRow({ id: 'ta-paid', origin: 'purchase' }),
        ownedRow({ id: 'ta-comp', code: 'module_inventory', name: 'Stok', origin: 'comp', compReason: 'pilot' }),
      ],
    });
    renderPage();
    const revokeButtons = screen.getAllByRole('button', { name: 'tenantDetail.owned.revoke' });
    expect(revokeButtons).toHaveLength(1);

    fireEvent.click(revokeButtons[0]);
    expect(revokeCompMutate).toHaveBeenCalledWith({
      tenantId: 'tid-1',
      tenantAddOnId: 'ta-comp',
    });
  });

  it('shows credit balances alongside the products', () => {
    licensing = licensingFixture({ owned: [ownedRow()], credits: { PHOTO: 42 } });
    renderPage();
    expect(screen.getByText('PHOTO')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });
});
