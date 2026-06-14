import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ScheduledDowngradeAlert from './ScheduledDowngradeAlert';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// The cancel mutation is the money-relevant action: it must fire with the
// exact subscriptionId. We expose a mock mutateAsync + a pending flag.
const mutateAsync = vi.fn();
let isPending = false;
vi.mock('../../features/subscriptions/subscriptionsApi', () => ({
  useCancelScheduledDowngrade: () => ({ mutateAsync, isPending }),
}));

const scheduledDowngrade = {
  scheduledPlanId: 'plan-basic',
  scheduledPlan: { displayName: 'Basic' } as any,
  scheduledBillingCycle: 'MONTHLY',
  scheduledFor: '2026-09-01T00:00:00.000Z',
};

describe('ScheduledDowngradeAlert', () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    isPending = false;
  });

  it('renders the target plan name and the scheduled date', () => {
    render(
      <ScheduledDowngradeAlert
        scheduledDowngrade={scheduledDowngrade}
        subscriptionId="sub-1"
      />,
    );

    expect(screen.getByText('Basic')).toBeInTheDocument();
    // formatDate uses toLocaleDateString(undefined, {short month}) →
    // "Sep 1, 2026" in the en test locale.
    expect(screen.getByText('Sep 1, 2026')).toBeInTheDocument();
  });

  it('falls back to the unknown-plan label when scheduledPlan is null', () => {
    render(
      <ScheduledDowngradeAlert
        scheduledDowngrade={{ ...scheduledDowngrade, scheduledPlan: null }}
        subscriptionId="sub-1"
      />,
    );
    expect(screen.getByText('subscriptions.unknownPlan')).toBeInTheDocument();
  });

  it('opens the confirm dialog, then cancels the scheduled downgrade with the subscriptionId', async () => {
    mutateAsync.mockResolvedValue(undefined);
    const onCancelled = vi.fn();
    render(
      <ScheduledDowngradeAlert
        scheduledDowngrade={scheduledDowngrade}
        subscriptionId="sub-42"
        onCancelled={onCancelled}
      />,
    );

    // No confirm dialog until the user opts in.
    expect(
      screen.queryByText('subscriptions.scheduledDowngrade.cancelTitle'),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'subscriptions.scheduledDowngrade.cancelDowngrade',
      }),
    );
    expect(
      screen.getByText('subscriptions.scheduledDowngrade.cancelTitle'),
    ).toBeInTheDocument();

    // Confirm ("keep current plan") fires the mutation with the sub id.
    fireEvent.click(
      screen.getByRole('button', {
        name: 'subscriptions.scheduledDowngrade.keepCurrentPlan',
      }),
    );

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith('sub-42');

    // onCancelled fires after the mutation resolves; dialog closes.
    await waitFor(() => expect(onCancelled).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText('subscriptions.scheduledDowngrade.cancelTitle'),
    ).toBeNull();
  });

  it('does NOT invoke onCancelled when the cancel mutation rejects', async () => {
    mutateAsync.mockRejectedValue(new Error('boom'));
    const onCancelled = vi.fn();
    render(
      <ScheduledDowngradeAlert
        scheduledDowngrade={scheduledDowngrade}
        subscriptionId="sub-9"
        onCancelled={onCancelled}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'subscriptions.scheduledDowngrade.cancelDowngrade',
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'subscriptions.scheduledDowngrade.keepCurrentPlan',
      }),
    );

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith('sub-9'));
    // Error path: callback is suppressed.
    expect(onCancelled).not.toHaveBeenCalled();
  });
});
