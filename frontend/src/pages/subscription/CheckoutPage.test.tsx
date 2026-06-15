import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CheckoutPage from './CheckoutPage';

// --- api layer mocks -------------------------------------------------
// createIntent.mutate is the money mutation we assert fires (and with
// which accepted-document-ids) only after the consent gate passes.
const createIntentMutate = vi.fn();
const updateProfileMutate = vi.fn();

vi.mock('../../api/paymentsApi', () => ({
  useCreatePaymentIntent: () => ({
    mutate: createIntentMutate,
    isPending: false,
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
    updateProfileMutate.mockClear();
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
  });
});
