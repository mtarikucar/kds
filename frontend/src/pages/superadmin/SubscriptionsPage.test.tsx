import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SubscriptionsPage from './SubscriptionsPage';

const extendMutate = vi.fn();
const cancelMutate = vi.fn();
let subsData: any;
let subsArg: any;
// deep-review FM11: mutable so a test can simulate an in-flight extend on a
// specific row (mutate carries the id; isPending alone can't identify the row).
let extendState: any = { isPending: false, variables: undefined };
let cancelState: any = { isPending: false, variables: undefined };

vi.mock('../../features/superadmin/api/superAdminApi', () => ({
  useSubscriptions: (filters: any) => {
    subsArg = filters;
    return { data: subsData, isLoading: false };
  },
  usePlans: () => ({ data: [{ id: 'p1', displayName: 'Pro Plan' }] }),
  useExtendSubscription: () => ({ mutate: extendMutate, ...extendState }),
  useCancelSubscription: () => ({ mutate: cancelMutate, ...cancelState }),
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
  // deep-review FM11: the page now surfaces errors via getApiErrorMessage,
  // which pulls in i18n/config.ts → `.use(initReactI18next)`. Provide the
  // plugin shape so the i18n module initialises under the mock.
  initReactI18next: { type: '3rdParty', init: () => undefined },
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

describe('SubscriptionsPage — extend modal (F8)', () => {
  beforeEach(() => {
    extendMutate.mockReset();
    cancelMutate.mockReset();
    extendState = { isPending: false, variables: undefined };
    cancelState = { isPending: false, variables: undefined };
    subsData = payload([sub()]);
  });
  afterEach(() => vi.restoreAllMocks());

  function openExtendModal() {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'subscriptions.extend' }));
  }

  it('opens the modal (days prefilled 30) and submits { id, days, reason: undefined }', () => {
    openExtendModal();
    expect(screen.getByText('subscriptions.extendModal.title')).toBeInTheDocument();
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('30');
    fireEvent.click(screen.getByRole('button', { name: 'subscriptions.extendModal.confirm' }));
    expect(extendMutate).toHaveBeenCalledTimes(1);
    expect(extendMutate).toHaveBeenCalledWith(
      { id: 'sub-1', days: 30, reason: undefined },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('forwards the typed days + reason to the DTO', () => {
    openExtendModal();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '7' } });
    // the only free-text textbox in the extend modal is the reason field
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'goodwill' } });
    fireEvent.click(screen.getByRole('button', { name: 'subscriptions.extendModal.confirm' }));
    expect(extendMutate).toHaveBeenCalledWith(
      { id: 'sub-1', days: 7, reason: 'goodwill' },
      expect.any(Object),
    );
  });

  it('disables Confirm and does NOT extend when the days input is cleared', () => {
    openExtendModal();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } });
    const confirm = screen.getByRole('button', { name: 'subscriptions.extendModal.confirm' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(extendMutate).not.toHaveBeenCalled();
  });

  it('shows the REINSTATE warning for a non-ACTIVE row (extend flips status → ACTIVE)', () => {
    subsData = payload([sub({ status: 'EXPIRED' })]);
    openExtendModal();
    expect(
      screen.getByText('subscriptions.extendModal.reinstateWarning::EXPIRED'),
    ).toBeInTheDocument();
  });

  it('does NOT show the reinstate warning for an ACTIVE row', () => {
    openExtendModal();
    expect(
      screen.queryByText(/subscriptions\.extendModal\.reinstateWarning/),
    ).not.toBeInTheDocument();
  });

  it('Back closes the modal without extending', () => {
    openExtendModal();
    fireEvent.click(screen.getByRole('button', { name: 'subscriptions.extendModal.back' }));
    expect(screen.queryByText('subscriptions.extendModal.title')).not.toBeInTheDocument();
    expect(extendMutate).not.toHaveBeenCalled();
  });
});

describe('SubscriptionsPage — cancel modal (F8)', () => {
  beforeEach(() => {
    extendMutate.mockReset();
    cancelMutate.mockReset();
    extendState = { isPending: false, variables: undefined };
    cancelState = { isPending: false, variables: undefined };
    subsData = payload([sub({ status: 'ACTIVE' })]);
  });
  afterEach(() => vi.restoreAllMocks());

  function openCancelModal() {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'subscriptions.cancel' }));
  }

  it('defaults to AT_PERIOD_END and sends the mode + reason: undefined', () => {
    openCancelModal();
    expect(screen.getByText('subscriptions.cancelModal.title')).toBeInTheDocument();
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios[0].checked).toBe(true); // AT_PERIOD_END is the default
    fireEvent.click(screen.getByRole('button', { name: 'subscriptions.cancelModal.confirm' }));
    expect(cancelMutate).toHaveBeenCalledWith(
      { id: 'sub-1', mode: 'AT_PERIOD_END', reason: undefined },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('selecting IMMEDIATE sends mode IMMEDIATE with the typed reason', () => {
    openCancelModal();
    fireEvent.click(screen.getAllByRole('radio')[1]); // IMMEDIATE
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Non-payment' } });
    fireEvent.click(screen.getByRole('button', { name: 'subscriptions.cancelModal.confirm' }));
    expect(cancelMutate).toHaveBeenCalledWith(
      { id: 'sub-1', mode: 'IMMEDIATE', reason: 'Non-payment' },
      expect.any(Object),
    );
  });

  it('Keep closes the modal without cancelling', () => {
    openCancelModal();
    fireEvent.click(screen.getByRole('button', { name: 'subscriptions.cancelModal.keep' }));
    expect(screen.queryByText('subscriptions.cancelModal.title')).not.toBeInTheDocument();
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
    extendState = { isPending: false, variables: undefined };
    cancelState = { isPending: false, variables: undefined };
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

describe('SubscriptionsPage — in-flight double-submit guard (FM11)', () => {
  beforeEach(() => {
    extendMutate.mockReset();
    cancelMutate.mockReset();
    extendState = { isPending: false, variables: undefined };
    cancelState = { isPending: false, variables: undefined };
    subsData = payload([sub({ id: 'sub-1' })]);
  });
  afterEach(() => vi.restoreAllMocks());

  it('disables that row Extend/Cancel while its extend is in flight', () => {
    extendState = { isPending: true, variables: { id: 'sub-1', days: 30 } };
    renderPage();
    expect(screen.getByRole('button', { name: 'subscriptions.extend' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'subscriptions.cancel' })).toBeDisabled();
  });

  it('does not open the extend modal while a mutation is already in flight', () => {
    extendState = { isPending: true, variables: { id: 'sub-1', days: 30 } };
    renderPage();
    // Button is disabled, but assert the handler short-circuit even if invoked.
    fireEvent.click(screen.getByRole('button', { name: 'subscriptions.extend' }));
    expect(screen.queryByText('subscriptions.extendModal.title')).not.toBeInTheDocument();
    expect(extendMutate).not.toHaveBeenCalled();
  });
});
