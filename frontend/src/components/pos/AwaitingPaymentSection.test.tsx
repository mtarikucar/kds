import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaymentStatus, type Order, type Payment } from '../../types';

/**
 * Specs for AwaitingPaymentSection's settle-up math. The HIGH bug pinned
 * here: after a partial/progressive payment the section charged the FULL
 * finalAmount, which the backend rejects ("Payment amount exceeds
 * remaining") — leaving the cashier with NO path to collect the true
 * balance. The section must display and pass the REMAINING due
 * (finalAmount − COMPLETED payments).
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../hooks/useFormatCurrency', () => ({
  useFormatCurrency: () => (amount: number) => `₺${amount.toFixed(2)}`,
}));

import AwaitingPaymentSection from './AwaitingPaymentSection';

const order = (over: Partial<Order>): Order =>
  ({
    id: 'o-1',
    orderNumber: '1001',
    finalAmount: 100,
    createdAt: '2026-07-27T10:00:00Z',
    items: [],
    ...over,
  } as Order);

const payment = (
  amount: number | string,
  status: PaymentStatus = PaymentStatus.COMPLETED,
): Payment => ({ id: `pay-${amount}-${status}`, amount, status } as unknown as Payment);

describe('AwaitingPaymentSection — remaining-due settle-up', () => {
  it('shows the full amount under "order total" and collects it when nothing is paid yet', () => {
    const onCollectPayment = vi.fn();
    render(
      <AwaitingPaymentSection
        orders={[order({ payments: [] })]}
        onCollectPayment={onCollectPayment}
      />,
    );

    expect(screen.getByText('awaitingPayment.orderTotal')).toBeTruthy();
    expect(screen.queryByText('awaitingPayment.remainingDue')).toBeNull();
    expect(screen.getByText('₺100.00')).toBeTruthy();

    fireEvent.click(screen.getByText('awaitingPayment.collectPayment'));
    expect(onCollectPayment).toHaveBeenCalledWith('o-1', 100);
  });

  it('shows and collects the REMAINING due after a partial payment (never the gross total)', () => {
    const onCollectPayment = vi.fn();
    render(
      <AwaitingPaymentSection
        orders={[
          order({
            // 60 completed counts; the refunded 40 must NOT (it would show
            // remaining 0 and strand a live 40 balance).
            payments: [payment(60), payment(40, PaymentStatus.REFUNDED)],
          }),
        ]}
        onCollectPayment={onCollectPayment}
      />,
    );

    expect(screen.getByText('awaitingPayment.remainingDue')).toBeTruthy();
    expect(screen.getByText('₺40.00')).toBeTruthy();
    // Gross total stays visible as struck-through context.
    expect(screen.getByText('₺100.00')).toBeTruthy();

    fireEvent.click(screen.getByText('awaitingPayment.collectPayment'));
    expect(onCollectPayment).toHaveBeenCalledWith('o-1', 40);
  });

  it('coerces string Decimal serializations (finalAmount and payment amounts)', () => {
    const onCollectPayment = vi.fn();
    render(
      <AwaitingPaymentSection
        orders={[
          order({
            finalAmount: '100.00' as unknown as number,
            payments: [payment('33.33'), payment('33.33')],
          }),
        ]}
        onCollectPayment={onCollectPayment}
      />,
    );

    expect(screen.getByText('₺33.34')).toBeTruthy();
    fireEvent.click(screen.getByText('awaitingPayment.collectPayment'));
    expect(onCollectPayment).toHaveBeenCalledWith('o-1', 33.34);
  });
});
