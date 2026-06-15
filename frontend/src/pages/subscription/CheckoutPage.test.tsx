import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AxiosError } from 'axios';
import CheckoutPage from './CheckoutPage';

/** Build a real AxiosError so `getApiErrorCode` (which gates on
 * `isAxiosError`) reads the `errorCode` off the response body. */
function apiError(errorCode: string, message = 'error') {
  const err = new AxiosError(message);
  // @ts-expect-error — minimal response shape, enough for the helpers.
  err.response = { status: 400, data: { errorCode, message } };
  return err;
}

// --- api layer mocks -------------------------------------------------
// createIntent.mutate is the money mutation we assert fires (and with
// which accepted-document-ids) only after the consent gate passes.
const createIntentMutate = vi.fn();
const createBankTransferMutate = vi.fn();
const updateProfileMutate = vi.fn();
// Toggled per-test to control whether the havale channel is offered.
let bankTransferEnabled = false;
// Currency of the (single) plan the checkout resolves. TRY → card available;
// anything else → card unavailable (PayTR only settles TRY).
let planCurrency = 'TRY';

vi.mock('../../api/paymentsApi', () => ({
  useCreatePaymentIntent: () => ({
    mutate: createIntentMutate,
    isPending: false,
  }),
  useBankTransferDetails: () => ({
    data: bankTransferEnabled
      ? {
          enabled: true,
          bankName: 'Test Bank',
          accountHolder: 'HummyTummy A.Ş.',
          iban: 'TR000000000000000000000000',
          instructions: 'Açıklamaya referans kodunu yazın.',
        }
      : { enabled: false, bankName: null, accountHolder: null, iban: null, instructions: null },
    isLoading: false,
    error: null,
  }),
  useCreateBankTransferIntent: () => ({
    mutate: createBankTransferMutate,
    isPending: false,
  }),
}));

// Plans query — provides the selected plan's currency. Default plan is TRY
// so the card option is available alongside havale.
vi.mock('../../features/subscriptions/subscriptionsApi', () => ({
  useGetPlans: () => ({
    data: [{ id: 'plan-pro', currency: planCurrency }],
    isLoading: false,
    error: null,
  }),
}));

vi.mock('../../features/users/usersApi', () => ({
  useUpdateProfile: () => ({ mutate: updateProfileMutate, isPending: false }),
}));

// Each of the three legal docs resolves to a current document with a
// stable id — the component submits these ids as acceptedDocumentIds.
vi.mock('../../features/legal/legalApi', () => ({
  useGetCurrentLegalDocument: (type: string) => ({
    data: { id: `doc-${type}`, version: '1' },
    isLoading: false,
    error: null,
  }),
}));

// Toast spy — the currency-unsupported path surfaces guidance via toast.error.
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  // CheckoutPage now imports the actionable-error helpers, which transitively
  // load the real i18n/config (it calls `.use(initReactI18next)`). Provide a
  // no-op plugin so that import doesn't throw under this mock.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    // Mirror i18next's two default-value forms used in CheckoutPage:
    //   t(key, 'Positional default')  and  t(key, { defaultValue: '...' })
    t: (key: string, arg?: any) => {
      if (typeof arg === 'string') return arg;
      if (arg && typeof arg.defaultValue === 'string') return arg.defaultValue;
      return key;
    },
  }),
}));

function renderCheckout(planId = 'plan-pro') {
  const search = planId ? `?planId=${planId}&billingCycle=MONTHLY` : '';
  return render(
    <MemoryRouter initialEntries={[`/subscription/checkout${search}`]}>
      <CheckoutPage />
    </MemoryRouter>,
  );
}

describe('CheckoutPage consent gate', () => {
  beforeEach(() => {
    createIntentMutate.mockClear();
    createBankTransferMutate.mockClear();
    updateProfileMutate.mockClear();
    toastError.mockClear();
    bankTransferEnabled = false;
    planCurrency = 'TRY';
  });

  it('blocks the payment intent until all three consents are checked', () => {
    renderCheckout();

    const proceed = screen.getByRole('button', {
      name: /Devam et — Ödemeye geç/i,
    });
    // Invalid state: nothing checked → CTA disabled, no mutation possible.
    expect(proceed).toBeDisabled();

    // Tick only two of the three required consents.
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);

    // Still invalid → still disabled → mutation must not have fired.
    expect(proceed).toBeDisabled();
    fireEvent.click(proceed);
    expect(createIntentMutate).not.toHaveBeenCalled();
  });

  it('fires the create-intent mutation with the accepted document ids once all consents are checked', () => {
    renderCheckout('plan-pro');

    screen.getAllByRole('checkbox').forEach((box) => fireEvent.click(box));

    const proceed = screen.getByRole('button', {
      name: /Devam et — Ödemeye geç/i,
    });
    expect(proceed).toBeEnabled();
    fireEvent.click(proceed);

    expect(createIntentMutate).toHaveBeenCalledTimes(1);
    const [payload] = createIntentMutate.mock.calls[0];
    expect(payload).toMatchObject({
      planId: 'plan-pro',
      billingCycle: 'MONTHLY',
      acceptedDocumentIds: ['doc-KVKK', 'doc-DISTANCE_SALES', 'doc-REFUND_POLICY'],
    });
    // Card is the default method → the card mutation fires, not havale.
    expect(createBankTransferMutate).not.toHaveBeenCalled();
  });

  it('does not offer the havale option when the channel is disabled', () => {
    bankTransferEnabled = false;
    renderCheckout('plan-pro');
    expect(screen.queryByRole('button', { name: /Havale \/ EFT/i })).toBeNull();
  });

  it('selecting Havale + submitting calls the bank-transfer intent and shows IBAN + reference', () => {
    bankTransferEnabled = true;
    renderCheckout('plan-pro');

    // The havale method option is offered alongside card.
    const havale = screen.getByRole('button', { name: /Havale \/ EFT/i });
    fireEvent.click(havale);

    // Accept all consents.
    screen.getAllByRole('checkbox').forEach((box) => fireEvent.click(box));

    const proceed = screen.getByRole('button', {
      name: /Devam et — Havale bilgilerini gör/i,
    });
    expect(proceed).toBeEnabled();
    fireEvent.click(proceed);

    // The havale intent fires (not the card one) with the same consent ids.
    expect(createBankTransferMutate).toHaveBeenCalledTimes(1);
    expect(createIntentMutate).not.toHaveBeenCalled();
    const [payload, callbacks] = createBankTransferMutate.mock.calls[0];
    expect(payload).toMatchObject({
      planId: 'plan-pro',
      billingCycle: 'MONTHLY',
      acceptedDocumentIds: ['doc-KVKK', 'doc-DISTANCE_SALES', 'doc-REFUND_POLICY'],
    });

    // Drive the success callback → instructions panel renders.
    act(() => {
      callbacks.onSuccess({
        provider: 'BANK_TRANSFER',
        reference: 'HT-REF-12345',
        amount: 499,
        currency: 'TRY',
        planName: 'Pro',
        bankDetails: {
          bankName: 'Test Bank',
          accountHolder: 'HummyTummy A.Ş.',
          iban: 'TR000000000000000000000000',
          instructions: 'Açıklamaya referans kodunu yazın.',
        },
      });
    });

    // The IBAN and the prominent reference code are shown.
    expect(screen.getByText('TR000000000000000000000000')).toBeInTheDocument();
    expect(screen.getByText('HT-REF-12345')).toBeInTheDocument();
    expect(screen.getByText(/499 TRY/)).toBeInTheDocument();
  });

  it('shows a no-payment-method dead-end (not the consent gate) when the plan is non-TRY and havale is off', () => {
    planCurrency = 'USD';
    bankTransferEnabled = false;
    renderCheckout('plan-pro');

    // The dead-end card, not the consent form.
    expect(
      screen.getByRole('heading', { name: /ödeme yöntemi kullanılamıyor/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Planları gör/i })).toBeInTheDocument();
    // No consent checkboxes and no proceed CTA — the user can't reach the gate.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Devam et/i })).toBeNull();
    // Currency is interpolated into the explanation.
    expect(screen.getByText(/USD/)).toBeInTheDocument();
  });

  it('defaults to havale (forces BANK_TRANSFER, hides card) for a non-TRY plan when havale is enabled', () => {
    planCurrency = 'USD';
    bankTransferEnabled = true;
    renderCheckout('plan-pro');

    // Only the havale CTA — card is not offered for a non-TRY plan.
    expect(
      screen.getByRole('button', { name: /Devam et — Havale bilgilerini gör/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Devam et — Ödemeye geç/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Kart ile öde/i })).toBeNull();

    // Submitting routes to the bank-transfer intent, not the card one.
    screen.getAllByRole('checkbox').forEach((box) => fireEvent.click(box));
    fireEvent.click(
      screen.getByRole('button', { name: /Devam et — Havale bilgilerini gör/i }),
    );
    expect(createBankTransferMutate).toHaveBeenCalledTimes(1);
    expect(createIntentMutate).not.toHaveBeenCalled();
  });

  it('on PAYTR_ONLY_SUPPORTS_TRY: toasts guidance and auto-switches to havale without resetting consents', () => {
    // TRY-mismatched edge: the plan currency desyncs between plan list and the
    // intent (PayTR rejects with the code). Card is the initial method; havale
    // is enabled so we can recover.
    bankTransferEnabled = true;
    renderCheckout('plan-pro');

    // Card is the default → its CTA is shown.
    const proceed = screen.getByRole('button', { name: /Devam et — Ödemeye geç/i });
    screen.getAllByRole('checkbox').forEach((box) => fireEvent.click(box));
    fireEvent.click(proceed);

    expect(createIntentMutate).toHaveBeenCalledTimes(1);
    const [, callbacks] = createIntentMutate.mock.calls[0];

    // PayTR rejects the card flow for a non-TRY plan.
    act(() => {
      callbacks.onError(apiError('PAYTR_ONLY_SUPPORTS_TRY'));
    });

    // Friendly guidance toasted (not a raw error screen).
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0][0])).toMatch(/kart ile ödeme yapılamıyor/i);
    expect(
      screen.queryByRole('heading', { name: /^Hata$/ }),
    ).toBeNull();

    // Auto-switched to havale: the CTA flipped to the bank-transfer label and
    // the consents are still ticked — so a single retry uses the havale intent.
    const havaleProceed = screen.getByRole('button', {
      name: /Devam et — Havale bilgilerini gör/i,
    });
    expect(havaleProceed).toBeEnabled();
    fireEvent.click(havaleProceed);
    expect(createBankTransferMutate).toHaveBeenCalledTimes(1);
  });
});
