import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Specs for CustomerDetailPage — the single-customer profile screen. We
 * mock the data hooks + the edit modal. Key states: loading placeholder,
 * not-found placeholder, the loaded render (name, loyalty tier, contact +
 * stats + order history), the edit-modal toggle, and the delete flow
 * (confirm gate → mutate → navigate back to the list).
 */

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom');
  return { ...actual, useNavigate: () => navigate, useParams: () => ({ id: 'c-1' }) };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, fb?: any) => (typeof fb === 'string' ? fb : k) }),
}));

let customerResult: any;
const deleteCustomer = vi.fn();
vi.mock('../../features/customers/customersApi', () => ({
  useCustomer: () => customerResult,
  useDeleteCustomer: () => ({ mutate: deleteCustomer }),
}));

let lastModalProps: any;
vi.mock('../../components/customers/CustomerFormModal', () => ({
  default: (props: any) => {
    lastModalProps = props;
    return props.isOpen ? <div data-testid="edit-modal" /> : null;
  },
}));

import CustomerDetailPage from './CustomerDetailPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <CustomerDetailPage />
    </MemoryRouter>,
  );
}

const customer = {
  id: 'c-1',
  name: 'Jane Roe',
  email: 'jane@x.com',
  phone: '555-1',
  phoneVerified: true,
  loyaltyTier: 'GOLD',
  loyaltyPoints: 420,
  totalOrders: 7,
  totalSpent: '123.5',
  averageOrder: '17.6',
  createdAt: '2025-01-01T00:00:00.000Z',
  tags: ['vip'],
  notes: 'Allergic to nuts',
  orders: [
    { id: 'o1', orderNumber: 'ORD-1', createdAt: '2025-02-01', status: 'PAID', finalAmount: '50' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  customerResult = { data: customer, isLoading: false };
});

describe('CustomerDetailPage — states', () => {
  it('shows the loading placeholder while fetching', () => {
    customerResult = { data: undefined, isLoading: true };
    renderPage();
    expect(screen.getByText('app:app.loading')).toBeInTheDocument();
  });

  it('shows the empty placeholder when the customer is missing', () => {
    customerResult = { data: undefined, isLoading: false };
    renderPage();
    expect(screen.getByText('customers.noCustomers')).toBeInTheDocument();
  });
});

describe('CustomerDetailPage — loaded render', () => {
  it('renders the name, loyalty tier, contact, stats and order history', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Jane Roe' })).toBeInTheDocument();
    expect(screen.getByText('GOLD')).toBeInTheDocument();
    expect(screen.getByText('jane@x.com')).toBeInTheDocument();
    // Stats: total orders + loyalty points.
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('420')).toBeInTheDocument();
    // Order history row.
    expect(screen.getByText('ORD-1')).toBeInTheDocument();
    expect(screen.getByText('vip')).toBeInTheDocument();
    expect(screen.getByText('Allergic to nuts')).toBeInTheDocument();
  });

  it('shows the no-orders placeholder when the customer has no orders', () => {
    customerResult = { data: { ...customer, orders: [] }, isLoading: false };
    renderPage();
    expect(screen.getByText('No orders yet')).toBeInTheDocument();
  });
});

describe('CustomerDetailPage — actions', () => {
  it('opens the edit modal and passes the customer to it', () => {
    renderPage();
    expect(screen.queryByTestId('edit-modal')).toBeNull();
    fireEvent.click(screen.getByText('customers.editCustomer'));
    expect(screen.getByTestId('edit-modal')).toBeInTheDocument();
    expect(lastModalProps.customer).toBe(customer);
  });

  it('deletes after confirmation and navigates back to the list', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteCustomer.mockImplementation((_id, opts) => opts.onSuccess());
    renderPage();
    fireEvent.click(screen.getByText('customers.deleteCustomer'));

    expect(deleteCustomer).toHaveBeenCalledWith('c-1', expect.objectContaining({ onSuccess: expect.any(Function) }));
    expect(navigate).toHaveBeenCalledWith('/customers');
  });

  it('does NOT delete when the confirm dialog is dismissed', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    fireEvent.click(screen.getByText('customers.deleteCustomer'));
    expect(deleteCustomer).not.toHaveBeenCalled();
  });

  it('navigates back to the list from the back button', () => {
    renderPage();
    // The back button is the first outline button (ArrowLeft icon only).
    const backBtn = screen.getAllByRole('button')[0];
    fireEvent.click(backBtn);
    expect(navigate).toHaveBeenCalledWith('/customers');
  });
});
