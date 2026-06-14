import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CustomersPage from './CustomersPage';
import type { Customer } from '../../types';

// --- mocks --------------------------------------------------------------

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: any) => (typeof fallback === 'string' ? fallback : key) }),
}));

// Pass-through resolver so the embedded CustomerFormModal submits without
// fighting field-level validation — we assert the page+modal wiring.
vi.mock('@hookform/resolvers/zod', () => ({
  zodResolver: () => async (values: any) => ({ values, errors: {} }),
}));

let customersResult: any;
const deleteCustomer = vi.fn();
const createCustomer = vi.fn();
const updateCustomer = vi.fn();
vi.mock('../../features/customers/customersApi', () => ({
  useCustomers: () => customersResult,
  useDeleteCustomer: () => ({ mutate: deleteCustomer }),
  useCreateCustomer: () => ({ mutate: createCustomer, isPending: false }),
  useUpdateCustomer: () => ({ mutate: updateCustomer, isPending: false }),
}));

// Pin the currency so formatCurrency is deterministic (EUR → € symbol).
vi.mock('../../hooks/useCurrency', async () => {
  const actual = await vi.importActual<any>('../../hooks/useCurrency');
  return { ...actual, useCurrency: () => 'EUR' };
});

vi.mock('../../components/ui/ErrorState', () => ({
  ErrorState: ({ onRetry }: any) => (
    <div>
      <span>error-state</span>
      <button onClick={onRetry}>retry</button>
    </div>
  ),
}));

function mk(over: Partial<Customer>): Customer {
  return {
    id: Math.random().toString(),
    name: 'X',
    email: '',
    phone: '',
    totalOrders: 0,
    totalSpent: 0,
    loyaltyPoints: 0,
    tags: [],
  } as unknown as Customer;
}

function renderPage() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CustomersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sampleCustomers: Customer[] = [
  { ...mk({}), id: 'a', name: 'Alice', email: 'alice@mail.com', phone: '+905551110000', totalOrders: 3, totalSpent: 100.5, loyaltyPoints: 20, tags: ['VIP'] } as Customer,
  { ...mk({}), id: 'b', name: 'Bob', email: 'bob@mail.com', phone: '+905552220000', totalOrders: 2, totalSpent: 50, loyaltyPoints: 5, tags: [] } as Customer,
  { ...mk({}), id: 'c', name: 'Carol', email: 'carol@mail.com', phone: '+905553330000', totalOrders: 0, totalSpent: 0, loyaltyPoints: 0, tags: [] } as Customer,
];

beforeEach(() => {
  vi.clearAllMocks();
  customersResult = {
    data: { data: sampleCustomers },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
});

describe('CustomersPage states', () => {
  it('renders a loading indicator while fetching', () => {
    customersResult = { ...customersResult, isLoading: true, data: undefined };
    renderPage();
    expect(screen.getByText('common:app.loading')).toBeInTheDocument();
  });

  it('renders the ErrorState (not an empty list) when the fetch fails', () => {
    customersResult = { ...customersResult, isError: true, error: new Error('boom') };
    renderPage();
    expect(screen.getByText('error-state')).toBeInTheDocument();
    fireEvent.click(screen.getByText('retry'));
    expect(customersResult.refetch).toHaveBeenCalled();
  });
});

describe('CustomersPage statistics', () => {
  it('aggregates totals across all customers and formats spend with the tenant currency', () => {
    renderPage();
    // Aggregate spend: 100.5 + 50 + 0 = 150.50, formatted with EUR symbol.
    expect(screen.getByText('€150.50')).toBeInTheDocument();

    // Each stat tile is a label paired with its value; assert via the
    // label's tile so per-row numbers don't collide with the aggregate.
    const ordersTile = screen.getByText('customers.totalOrders').closest('div')!.parentElement!;
    expect(within(ordersTile).getByText('5')).toBeInTheDocument(); // 3+2+0
    const pointsTile = screen.getByText('customers.loyaltyPoints').closest('div')!.parentElement!;
    expect(within(pointsTile).getByText('25')).toBeInTheDocument(); // 20+5+0
  });

  it('hides the stats panel entirely when there are no customers', () => {
    customersResult = { ...customersResult, data: { data: [] } };
    renderPage();
    expect(screen.queryByText('customers.totalSpent')).not.toBeInTheDocument();
    // Empty list → first-customer CTA.
    expect(screen.getByText('customers.noCustomers')).toBeInTheDocument();
  });
});

describe('CustomersPage search filtering', () => {
  it('matches by name (case-insensitive)', () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('customers.search'), {
      target: { value: 'ali' },
    });
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
    expect(screen.queryByText('Carol')).not.toBeInTheDocument();
  });

  it('matches by email substring', () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('customers.search'), {
      target: { value: 'bob@mail' },
    });
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('matches by phone substring', () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('customers.search'), {
      target: { value: '3330000' },
    });
    expect(screen.getByText('Carol')).toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('shows the no-search-results state (not the add-first CTA) when a query matches nothing', () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('customers.search'), {
      target: { value: 'zzz-nobody' },
    });
    expect(screen.getByText('customers.noSearchResults')).toBeInTheDocument();
    // The "add first customer" CTA is suppressed during an active search.
    expect(screen.queryByText('customers.addFirstCustomer')).not.toBeInTheDocument();
  });
});

describe('CustomersPage delete flow', () => {
  it('only deletes after the confirmation modal is confirmed', () => {
    renderPage();
    // Open delete confirmation for Alice.
    const aliceRow = screen.getByText('Alice').closest('div.group') as HTMLElement;
    fireEvent.click(within(aliceRow).getByRole('button', { name: 'common:app.delete' }));

    // Confirmation dialog shows the target name; nothing deleted yet.
    expect(deleteCustomer).not.toHaveBeenCalled();

    // Confirm via the danger button inside the dialog.
    const dialog = screen.getByText('common:messages.actionCannotBeUndone').closest('div')!
      .parentElement!.parentElement as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:app.delete' }));
    expect(deleteCustomer).toHaveBeenCalledWith('a');
  });
});

describe('CustomersPage navigation', () => {
  it('navigates to the detail route when View is clicked', () => {
    renderPage();
    const bobRow = screen.getByText('Bob').closest('div.group') as HTMLElement;
    fireEvent.click(within(bobRow).getByRole('button', { name: 'common:app.view' }));
    expect(navigate).toHaveBeenCalledWith('/customers/b');
  });
});

describe('CustomersPage → add-customer modal payload', () => {
  it('creates a customer with the trimmed name from the embedded modal', async () => {
    renderPage();
    // Only the header CTA exists before the modal opens.
    fireEvent.click(screen.getByRole('button', { name: 'customers.addCustomer' }));

    // The real CustomerFormModal is now open as a dialog. Fill the required
    // name and submit via the dialog-scoped save button (same label as the
    // header CTA, so we must scope to the dialog to disambiguate).
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/customers.firstName/), {
      target: { value: '  New Guest  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'customers.addCustomer' }));

    await waitFor(() => expect(createCustomer).toHaveBeenCalledTimes(1));
    expect(createCustomer.mock.calls[0][0]).toEqual({ name: 'New Guest' });
  });
});
