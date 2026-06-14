import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PlansPage from './PlansPage';

const createMutate = vi.fn();
const updateMutate = vi.fn();
const deleteMutate = vi.fn();
let plansData: any;

vi.mock('../../features/superadmin/api/superAdminApi', () => ({
  usePlans: () => ({ data: plansData, isLoading: false }),
  useCreatePlan: () => ({ mutate: createMutate, isPending: false }),
  useUpdatePlan: () => ({ mutate: updateMutate, isPending: false }),
  useDeletePlan: () => ({ mutate: deleteMutate, isPending: false }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, arg?: any) => {
      if (typeof arg === 'string') return arg;
      if (arg && typeof arg === 'object' && Object.keys(arg).length) {
        return `${key}::${Object.values(arg).join(',')}`;
      }
      return key;
    },
  }),
}));

function plan(over: Partial<any> = {}) {
  return {
    id: 'p1',
    name: 'PRO',
    displayName: 'Pro Plan',
    monthlyPrice: 1000,
    yearlyPrice: 10000,
    currency: 'TRY',
    maxUsers: 5,
    maxTables: 10,
    maxProducts: 100,
    maxMonthlyOrders: 1000,
    maxCategories: 20,
    advancedReports: true,
    multiLocation: false,
    customBranding: false,
    apiAccess: false,
    prioritySupport: false,
    inventoryTracking: false,
    kdsIntegration: true,
    reservationSystem: false,
    personnelManagement: false,
    isActive: true,
    _count: { subscriptions: 4 },
    ...over,
  };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <PlansPage />
    </QueryClientProvider>,
  );
}

describe('PlansPage — discounted price rendering', () => {
  beforeEach(() => {
    plansData = [plan()];
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows just the regular monthly price when no discount is active', () => {
    renderPage();
    // 1000 → "1,000" via toLocaleString; struck price absent.
    expect(screen.getByText(/1,000/)).toBeInTheDocument();
    expect(screen.queryByText(/defaultDiscountLabel/)).not.toBeInTheDocument();
  });

  it('renders the discounted price (regular struck + 20% off computed)', () => {
    plansData = [
      plan({ isDiscountActive: true, discountPercentage: 20, discountLabel: 'Launch' }),
    ];
    renderPage();
    // discountedMonthlyPrice(1000, 20) = 800
    expect(screen.getByText(/^₺800/)).toBeInTheDocument();
    // the discount badge shows the percentage + label
    expect(screen.getByText(/%20 Launch/)).toBeInTheDocument();
  });

  it('shows the active-subscriptions count from _count', () => {
    renderPage();
    expect(screen.getByText('plans.activeSubscriptions::4')).toBeInTheDocument();
  });
});

describe('PlansPage — delete flow', () => {
  beforeEach(() => {
    deleteMutate.mockReset();
    plansData = [plan({ id: 'plan-del' })];
  });
  afterEach(() => vi.restoreAllMocks());

  it('confirms then deletes by id', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    // The two icon buttons in the card header are [edit, delete].
    const card = screen.getByText('Pro Plan').closest('div')!.parentElement!.parentElement as HTMLElement;
    const buttons = within(card).getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1]);
    expect(window.confirm).toHaveBeenCalledWith('plans.confirmDelete');
    expect(deleteMutate).toHaveBeenCalledWith('plan-del');
  });

  it('does NOT delete when confirm is declined', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    const card = screen.getByText('Pro Plan').closest('div')!.parentElement!.parentElement as HTMLElement;
    const buttons = within(card).getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1]);
    expect(deleteMutate).not.toHaveBeenCalled();
  });
});

describe('PlansPage — PlanModal create', () => {
  beforeEach(() => {
    createMutate.mockReset();
    updateMutate.mockReset();
    plansData = [];
  });
  afterEach(() => vi.restoreAllMocks());

  it('opens the create modal and submits create() with the form data (no id)', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /plans\.addPlan/ }));
    // Modal title shows the create variant.
    expect(screen.getByText('plans.modal.createTitle')).toBeInTheDocument();

    // Fill the required internal-name + display-name fields
    // (label → sibling input within the wrapper).
    const nameWrap = screen.getByText('plans.modal.internalName').closest('div') as HTMLElement;
    const nameInput = within(nameWrap).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'STARTER' } });
    const displayWrap = screen.getByText('plans.modal.displayName').closest('div') as HTMLElement;
    const displayInput = within(displayWrap).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(displayInput, { target: { value: 'Starter' } });

    // Submit the form (PlanModal wires onSubmit → onSave → create()).
    fireEvent.submit(nameInput.closest('form') as HTMLFormElement);

    expect(createMutate).toHaveBeenCalledTimes(1);
    const body = createMutate.mock.calls[0][0];
    expect(body).toMatchObject({ name: 'STARTER', kdsIntegration: true, isActive: true });
    // create() must not carry an id.
    expect(body.id).toBeUndefined();
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('Edit opens the modal with update title and routes submit to update() with id', () => {
    plansData = [plan({ id: 'p-edit', name: 'PRO', displayName: 'Pro Plan' })];
    renderPage();
    // The first icon button in the card is Edit.
    const card = screen.getByText('Pro Plan').closest('div')!.parentElement!.parentElement as HTMLElement;
    const buttons = within(card).getAllByRole('button');
    fireEvent.click(buttons[0]);
    expect(screen.getByText('plans.modal.editTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'plans.modal.update' }));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0][0]).toMatchObject({ id: 'p-edit', name: 'PRO' });
    expect(createMutate).not.toHaveBeenCalled();
  });

  it('closing the modal via Cancel fires no mutation', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /plans\.addPlan/ }));
    fireEvent.click(screen.getByRole('button', { name: 'plans.modal.cancel' }));
    expect(screen.queryByText('plans.modal.createTitle')).not.toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();
  });
});
