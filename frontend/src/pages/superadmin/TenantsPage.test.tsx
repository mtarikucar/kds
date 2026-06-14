import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TenantsPage from './TenantsPage';

// Mocks for the feature api-hooks. useTenants is the read; useUpdateTenantStatus
// is the write whose .mutate we assert is fired with the exact { id, status }.
const updateStatusMutate = vi.fn();
let tenantsArg: any;
const useTenantsImpl = vi.fn();

vi.mock('../../features/superadmin/api/superAdminApi', () => ({
  useTenants: (filters: any) => {
    tenantsArg = filters;
    return useTenantsImpl(filters);
  },
  useUpdateTenantStatus: () => ({ mutate: updateStatusMutate, isPending: false }),
}));

// i18n: echo keys but interpolate args so we can assert the confirm() message
// the component actually builds (e.g. tenants.confirmStatusChange::SUSPENDED).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, arg?: Record<string, unknown>) => {
      if (arg && Object.keys(arg).length) {
        return `${key}::${Object.values(arg).join(',')}`;
      }
      return key;
    },
  }),
}));

function makeTenant(over: Partial<any> = {}) {
  return {
    id: 't1',
    name: 'Acme Diner',
    subdomain: 'acme',
    status: 'ACTIVE',
    createdAt: '2026-01-02T00:00:00.000Z',
    currentPlan: { id: 'p1', name: 'PRO', displayName: 'Pro Plan' },
    _count: { users: 3, orders: 42, tables: 5, products: 10 },
    ...over,
  };
}

function pagePayload(tenants: any[], meta: Partial<any> = {}) {
  return {
    data: tenants,
    meta: { total: tenants.length, page: 1, limit: 20, totalPages: 1, ...meta },
  };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TenantsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TenantsPage', () => {
  beforeEach(() => {
    updateStatusMutate.mockReset();
    useTenantsImpl.mockReset();
    tenantsArg = undefined;
    useTenantsImpl.mockReturnValue({
      data: pagePayload([makeTenant()]),
      isLoading: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a tenant row with name, subdomain, plan and usage', () => {
    renderPage();
    expect(screen.getByText('Acme Diner')).toBeInTheDocument();
    expect(screen.getByText('acme')).toBeInTheDocument();
    expect(screen.getByText('Pro Plan')).toBeInTheDocument();
    // usage interpolates users + orders
    expect(screen.getByText('tenants.usage::3,42')).toBeInTheDocument();
  });

  it('shows the empty-state row when the page has zero tenants', () => {
    useTenantsImpl.mockReturnValue({ data: pagePayload([]), isLoading: false });
    renderPage();
    expect(screen.getByText('tenants.noTenantsFound')).toBeInTheDocument();
  });

  it('shows the loading spinner row (no empty-state) while fetching', () => {
    useTenantsImpl.mockReturnValue({ data: undefined, isLoading: true });
    renderPage();
    expect(screen.queryByText('tenants.noTenantsFound')).not.toBeInTheDocument();
    expect(screen.queryByText('Acme Diner')).not.toBeInTheDocument();
  });

  it('passes the current filters (page/limit/sort) + search to useTenants', () => {
    renderPage();
    // Initial query args mirror the component's default filter state.
    expect(tenantsArg).toMatchObject({
      page: 1,
      limit: 20,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      search: undefined,
    });
  });

  it('forwards the status filter into the useTenants query when changed', () => {
    renderPage();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'SUSPENDED' } });
    expect(tenantsArg).toMatchObject({ status: 'SUSPENDED', page: 1 });
  });

  it('debounces search into the query only on form submit', () => {
    renderPage();
    const input = screen.getByPlaceholderText('tenants.searchPlaceholder');
    fireEvent.change(input, { target: { value: 'acme' } });
    // Typing alone re-renders and passes the controlled search through.
    expect(tenantsArg.search).toBe('acme');
  });
});

describe('TenantsPage — pagination & navigation', () => {
  beforeEach(() => {
    updateStatusMutate.mockReset();
    useTenantsImpl.mockReset();
    useTenantsImpl.mockReturnValue({
      data: pagePayload([makeTenant({ id: 'tid-9', status: 'ACTIVE' })]),
      isLoading: false,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('paginates: Previous disabled on page 1, Next advances the query', () => {
    useTenantsImpl.mockReturnValue({
      data: pagePayload([makeTenant()], { page: 1, totalPages: 3, total: 50 }),
      isLoading: false,
    });
    renderPage();
    const prev = screen.getByRole('button', { name: 'common.previous' });
    const next = screen.getByRole('button', { name: 'common.next' });
    expect(prev).toBeDisabled();
    expect(next).not.toBeDisabled();
    fireEvent.click(next);
    expect(tenantsArg.page).toBe(2);
  });

  it('hides pagination controls when there is a single page', () => {
    useTenantsImpl.mockReturnValue({
      data: pagePayload([makeTenant()], { page: 1, totalPages: 1 }),
      isLoading: false,
    });
    renderPage();
    expect(screen.queryByRole('button', { name: 'common.next' })).not.toBeInTheDocument();
  });

  it('Next is disabled on the last page', () => {
    useTenantsImpl.mockReturnValue({
      data: pagePayload([makeTenant()], { page: 3, totalPages: 3, total: 50 }),
      isLoading: false,
    });
    renderPage();
    expect(screen.getByRole('button', { name: 'common.next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'common.previous' })).not.toBeDisabled();
  });

  it('row links to the tenant detail page by id', () => {
    renderPage();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/superadmin/tenants/tid-9');
  });
});
