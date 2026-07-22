import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * handlePay's catch block used to look ONLY at `err.response.data.code` —
 * the field self-pay-domain errors carry (see selfPayError() in
 * self-pay-pricing.util.ts) — and otherwise fell back to the backend's raw
 * `message`. The shared DemoGuardService (blocking real-money initiation for
 * the demo tenant) throws the standard NestJS shape with `errorCode`
 * instead, so a demo-blocked self-pay leaked the backend's hardcoded-Turkish
 * message under every locale. It's now wired through getApiErrorMessage as
 * a fallback so errorCode-based errors (DEMO_PAYMENT_BLOCKED and any other
 * standard apiCodes entry) are localized too, while the self-pay-specific
 * `code` mapping (common:payment.errors.*) still takes priority when present.
 */

// framer-motion: render motion.* as plain passthrough elements so the modal
// content is always in the DOM regardless of animation state.
vi.mock('framer-motion', () => {
  const passthrough =
    (tag: string) =>
    ({ children, whileTap, animate, initial, exit, transition, mode, layout, ...rest }: Record<string, unknown>) => {
      const El = tag as keyof JSX.IntrinsicElements;
      return <El {...(rest as Record<string, unknown>)}>{children as React.ReactNode}</El>;
    };
  return {
    motion: new Proxy({}, { get: (_t, tag: string) => passthrough(tag) }),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m) } }));

const PAYABLE = {
  sessionId: 's1',
  tableId: 't1',
  selfPayEnabled: true,
  orders: [
    {
      orderId: 'o1',
      orderNumber: '1001',
      finalAmount: '100',
      paidAmount: '0',
      remainingAmount: '100',
      items: [
        {
          orderItemId: 'i1',
          productName: 'Pizza',
          quantity: 2,
          paidQuantity: 0,
          remainingQuantity: 2,
          unitTotal: '50',
          itemTotal: '100',
          modifierLabels: [],
        },
      ],
    },
  ],
  summary: { totalAmount: '100', paidAmount: '0', remainingAmount: '100', remainingQuantity: 2 },
};

const mutateAsync = vi.fn();
vi.mock('../../features/qr-menu/customerPayApi', () => ({
  useSessionPayableItems: () => ({ data: PAYABLE, isLoading: false }),
  useCreatePayIntent: () => ({ mutateAsync, isPending: false }),
}));

import SelfPayModal from './SelfPayModal';

function renderModal() {
  render(
    <SelfPayModal
      isOpen
      onClose={vi.fn()}
      sessionId="s1"
      currency="TRY"
      primaryColor="#4f46e5"
    />,
  );
}

async function selectOneAndPay() {
  // Bump the item's stepper from 0 -> 1, then submit.
  const plusButtons = screen.getAllByRole('button').filter((b) => b.querySelector('svg.lucide-plus'));
  fireEvent.click(plusButtons[0]);
  fireEvent.click(screen.getByRole('button', { name: /pay with paytr/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SelfPayModal — payment error localization', () => {
  it('localizes a DEMO_PAYMENT_BLOCKED (errorCode-shaped) failure via getApiErrorMessage', async () => {
    mutateAsync.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        data: {
          statusCode: 403,
          errorCode: 'DEMO_PAYMENT_BLOCKED',
          message: 'Demo modunda ödeme alınamaz.',
        },
      },
    });

    renderModal();
    await selectOneAndPay();

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    // en locale string for errors:apiCodes.DEMO_PAYMENT_BLOCKED — not the
    // backend's raw (always-Turkish) message.
    expect(toastError).toHaveBeenCalledWith("Payments can't be made in demo mode.");
  });

  it('still prefers the self-pay-domain `code` mapping when present', async () => {
    mutateAsync.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        data: {
          statusCode: 400,
          code: 'SELF_PAY_DISABLED',
          message: "This restaurant hasn't enabled self-pay online.",
        },
      },
    });

    renderModal();
    await selectOneAndPay();

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError).toHaveBeenCalledWith(
      "This restaurant hasn't enabled self-pay. Please call the waiter.",
    );
  });
});
