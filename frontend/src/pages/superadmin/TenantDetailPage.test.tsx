import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TenantDetailPage from './TenantDetailPage';

// ── api-hook mocks ───────────────────────────────────────────────────────
const updateStatusMutate = vi.fn();
const changePlanMutate = vi.fn();
const updateOverridesMutate = vi.fn();
const resetOverridesMutate = vi.fn();

let tenant: any;
let overridesData: any;
let plans: any;

vi.mock('../../features/superadmin/api/superAdminApi', () => ({
  useTenant: () => ({ data: tenant, isLoading: false }),
  useTenantUsers: () => ({ data: { data: [] } }),
  useTenantOrders: () => ({ data: { data: [] } }),
  useTenantStats: () => ({ data: { revenue: { total: 0 }, orders: { today: 0, thisMonth: 0 } } }),
  usePlans: () => ({ data: plans }),
  useChangeSubscriptionPlan: () => ({ mutate: changePlanMutate, isPending: false, isError: false }),
  useTenantOverrides: () => ({ data: overridesData }),
  useUpdateTenantStatus: () => ({ mutate: updateStatusMutate, isPending: false }),
  useUpdateTenantOverrides: () => ({ mutate: updateOverridesMutate, isPending: false }),
  useResetTenantOverrides: () => ({ mutate: resetOverridesMutate, isPending: false }),
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

describe('TenantDetailPage — status-change confirm flow', () => {
  beforeEach(() => {
    updateStatusMutate.mockReset();
    tenant = baseTenant();
    overridesData = undefined;
    plans = [];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('fires updateStatus({ id, status: SUSPENDED }) when the operator confirms Suspend', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'tenantDetail.suspend' }));
    expect(window.confirm).toHaveBeenCalledWith('tenantDetail.confirmStatusChange::SUSPENDED');
    expect(updateStatusMutate).toHaveBeenCalledTimes(1);
    expect(updateStatusMutate).toHaveBeenCalledWith({ id: 'tid-1', status: 'SUSPENDED' });
  });

  it('does NOT fire the mutation when the operator cancels the confirm', () => {
    (window.confirm as any).mockReturnValue(false);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'tenantDetail.delete' }));
    expect(window.confirm).toHaveBeenCalledWith('tenantDetail.confirmStatusChange::DELETED');
    expect(updateStatusMutate).not.toHaveBeenCalled();
  });

  it('shows Activate (not Suspend) for a SUSPENDED tenant and sends status ACTIVE', () => {
    tenant = baseTenant({ status: 'SUSPENDED' });
    renderPage();
    expect(screen.queryByRole('button', { name: 'tenantDetail.suspend' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'tenantDetail.activate' }));
    expect(updateStatusMutate).toHaveBeenCalledWith({ id: 'tid-1', status: 'ACTIVE' });
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
    plans = [];
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

describe('TenantDetailPage — change-plan modal', () => {
  beforeEach(() => {
    changePlanMutate.mockReset();
    tenant = baseTenant();
    overridesData = undefined;
    plans = [
      { id: 'p1', displayName: 'Pro Plan', monthlyPrice: 500, maxUsers: 5, maxTables: 10, maxProducts: 100 },
      { id: 'p2', displayName: 'Enterprise', monthlyPrice: 1500, maxUsers: 50, maxTables: 100, maxProducts: 1000 },
    ];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('opens the modal, selecting a new plan enables Confirm, and fires changePlan with subscriptionId+planId', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'tenantDetail.changePlan' }));
    // current plan (p1) preselected; confirm disabled because == current
    const radios = screen.getAllByRole('radio');
    // pick the Enterprise (p2) radio
    fireEvent.click(radios[1]);
    // the modal's confirm button label is changePlan too — grab the enabled one
    const confirmBtns = screen.getAllByRole('button', { name: 'tenantDetail.changePlan' });
    const modalConfirm = confirmBtns[confirmBtns.length - 1];
    fireEvent.click(modalConfirm);
    expect(changePlanMutate).toHaveBeenCalledTimes(1);
    expect(changePlanMutate.mock.calls[0][0]).toMatchObject({
      subscriptionId: 'sub-1',
      planId: 'p2',
    });
  });

  it('Confirm stays disabled when the selected plan equals the current plan', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'tenantDetail.changePlan' }));
    const confirmBtns = screen.getAllByRole('button', { name: 'tenantDetail.changePlan' });
    const modalConfirm = confirmBtns[confirmBtns.length - 1];
    expect(modalConfirm).toBeDisabled();
    fireEvent.click(modalConfirm);
    expect(changePlanMutate).not.toHaveBeenCalled();
  });
});
