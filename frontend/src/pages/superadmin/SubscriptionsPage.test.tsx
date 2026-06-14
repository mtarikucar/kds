import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SubscriptionsPage from './SubscriptionsPage';

const extendMutate = vi.fn();
const cancelMutate = vi.fn();
let subsData: any;
let subsArg: any;

vi.mock('../../features/superadmin/api/superAdminApi', () => ({
  useSubscriptions: (filters: any) => {
    subsArg = filters;
    return { data: subsData, isLoading: false };
  },
  usePlans: () => ({ data: [{ id: 'p1', displayName: 'Pro Plan' }] }),
  useExtendSubscription: () => ({ mutate: extendMutate, isPending: false }),
  useCancelSubscription: () => ({ mutate: cancelMutate, isPending: false }),
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

function sub(over: Partial<any> = {}) {
  return {
    id: 'sub-1',
    status: 'ACTIVE',
    billingCycle: 'MONTHLY',
    amount: 500,
    currentPeriodEnd: '2026-12-31T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    tenant: { id: 't1', name: 'Acme Diner', subdomain: 'acme' },
    plan: { id: 'p1', name: 'PRO', displayName: 'Pro Plan' },
    ...over,
  };
}

function payload(subs: any[], meta: Partial<any> = {}) {
  return { data: subs, meta: { total: subs.length, page: 1, limit: 20, totalPages: 1, ...meta } };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SubscriptionsPage />
    </QueryClientProvider>,
  );
}

describe('SubscriptionsPage — extend-days NaN guard', () => {
  beforeEach(() => {
    extendMutate.mockReset();
    cancelMutate.mockReset();
    subsData = payload([sub()]);
  });
  afterEach(() => vi.restoreAllMocks());

  it('extends when the prompt returns a numeric string', () => {
    vi.spyOn(window, 'prompt').mockReturnValue('30');
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'subscriptions.extend' }));
    expect(extendMutate).toHaveBeenCalledTimes(1);
    expect(extendMutate).toHaveBeenCalledWith({ id: 'sub-1', days: 30 });
  });

  it('does NOT extend when the prompt is cancelled (null)', () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'subscriptions.extend' }));
    expect(extendMutate).not.toHaveBeenCalled();
  });

  it('does NOT extend when the prompt is non-numeric (NaN guard)', () => {
    vi.spyOn(window, 'prompt').mockReturnValue('abc');
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'subscriptions.extend' }));
    expect(extendMutate).not.toHaveBeenCalled();
  });

  it('does NOT extend on an empty string', () => {
    vi.spyOn(window, 'prompt').mockReturnValue('');
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'subscriptions.extend' }));
    expect(extendMutate).not.toHaveBeenCalled();
  });
});

describe('SubscriptionsPage — cancel-reason flow', () => {
  beforeEach(() => {
    extendMutate.mockReset();
    cancelMutate.mockReset();
    subsData = payload([sub({ status: 'ACTIVE' })]);
  });
  afterEach(() => vi.restoreAllMocks());

  it('confirms, prompts for a reason, and cancels with that reason', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'prompt').mockReturnValue('Non-payment');
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'subscriptions.cancel' }));
    expect(window.confirm).toHaveBeenCalledWith('subscriptions.confirmCancel');
    expect(cancelMutate).toHaveBeenCalledWith({ id: 'sub-1', reason: 'Non-payment' });
  });

  it('cancels with reason=undefined when the reason prompt is left blank', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'prompt').mockReturnValue('');
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'subscriptions.cancel' }));
    expect(cancelMutate).toHaveBeenCalledWith({ id: 'sub-1', reason: undefined });
  });

  it('does NOT prompt or cancel when the confirm is declined', () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'subscriptions.cancel' }));
    expect(promptSpy).not.toHaveBeenCalled();
    expect(cancelMutate).not.toHaveBeenCalled();
  });

  it('hides the Cancel action for a non-ACTIVE subscription', () => {
    subsData = payload([sub({ status: 'CANCELLED' })]);
    renderPage();
    expect(screen.queryByRole('button', { name: 'subscriptions.cancel' })).not.toBeInTheDocument();
    // extend remains available
    expect(screen.getByRole('button', { name: 'subscriptions.extend' })).toBeInTheDocument();
  });
});

describe('SubscriptionsPage — listing & filters', () => {
  beforeEach(() => {
    subsData = payload([sub()]);
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders the tenant + plan + formatted status', () => {
    renderPage();
    expect(screen.getByText('Acme Diner')).toBeInTheDocument();
    expect(screen.getAllByText('Pro Plan').length).toBeGreaterThan(0);
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
  });

  it('passes the status filter into the query and resets to page 1', () => {
    renderPage();
    const statusSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(statusSelect, { target: { value: 'TRIALING' } });
    expect(subsArg).toMatchObject({ status: 'TRIALING', page: 1 });
  });
});
