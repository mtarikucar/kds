import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CancelSubscriptionModal from './CancelSubscriptionModal';

// i18next mocked inline so we assert on stable keys / interpolated values
// (dates) rather than the translated `subscriptions` bundle copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => {
      if (key === 'subscriptions.cancelModal.warnPeriodEnd') {
        return `warnPeriodEnd:${opts?.date ?? ''}`;
      }
      return key;
    },
  }),
}));

// Button reads useTranslation('common'); the mock above covers it. Modal
// also reads it. Render Modal's children directly.
vi.mock('../ui/Modal', () => ({
  default: ({ isOpen, children, title }: any) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
}));

describe('CancelSubscriptionModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the confirm CTA disabled until a reason is chosen', () => {
    render(
      <CancelSubscriptionModal
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const confirm = screen.getByRole('button', {
      name: 'subscriptions.cancelModal.confirm',
    });
    expect(confirm).toBeDisabled();
  });

  it('confirms with the structured reason text (not the raw key) and immediate=false by default', () => {
    const onConfirm = vi.fn();
    render(
      <CancelSubscriptionModal open onClose={vi.fn()} onConfirm={onConfirm} />,
    );

    // Pick "tooExpensive" — a non-"other" reason resolves to its translated label.
    fireEvent.click(
      screen.getByText('subscriptions.cancelModal.reasons.tooExpensive'),
    );

    const confirm = screen.getByRole('button', {
      name: 'subscriptions.cancelModal.confirm',
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      immediate: false,
      reason: 'subscriptions.cancelModal.reasons.tooExpensive',
    });
  });

  it('requires free-text when "other" is selected and forwards the typed reason', () => {
    const onConfirm = vi.fn();
    render(
      <CancelSubscriptionModal open onClose={vi.fn()} onConfirm={onConfirm} />,
    );

    fireEvent.click(screen.getByText('subscriptions.cancelModal.reasons.other'));

    // "other" with no text → still disabled.
    const confirm = screen.getByRole('button', {
      name: 'subscriptions.cancelModal.confirm',
    });
    expect(confirm).toBeDisabled();

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '  switching to a POS  ' } });

    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    // Free-text is trimmed before being sent to the backend.
    expect(onConfirm).toHaveBeenCalledWith({
      immediate: false,
      reason: 'switching to a POS',
    });
  });

  it('passes immediate=true once the cancel-now checkbox is checked', () => {
    const onConfirm = vi.fn();
    render(
      <CancelSubscriptionModal open onClose={vi.fn()} onConfirm={onConfirm} />,
    );

    fireEvent.click(
      screen.getByText('subscriptions.cancelModal.reasons.tooExpensive'),
    );
    fireEvent.click(screen.getByRole('checkbox'));

    fireEvent.click(
      screen.getByRole('button', { name: 'subscriptions.cancelModal.confirm' }),
    );

    expect(onConfirm).toHaveBeenCalledWith({
      immediate: true,
      reason: 'subscriptions.cancelModal.reasons.tooExpensive',
    });
  });

  it('shows the end-of-period warning with the localized periodEnd date when not immediate', () => {
    render(
      <CancelSubscriptionModal
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        periodEnd={new Date('2026-07-31T00:00:00.000Z')}
      />,
    );

    // toLocaleDateString('tr-TR') of 2026-07-31 → 31.07.2026
    expect(
      screen.getByText('warnPeriodEnd:31.07.2026'),
    ).toBeInTheDocument();
  });

  it('swaps to the immediate-warning copy once cancel-now is checked', () => {
    render(
      <CancelSubscriptionModal
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        periodEnd={new Date('2026-07-31T00:00:00.000Z')}
      />,
    );

    expect(screen.queryByText('subscriptions.cancelModal.warnImmediate')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(
      screen.getByText('subscriptions.cancelModal.warnImmediate'),
    ).toBeInTheDocument();
  });

  it('disables both buttons while a cancellation request is in flight', () => {
    const onConfirm = vi.fn();
    render(
      <CancelSubscriptionModal
        open
        onClose={vi.fn()}
        onConfirm={onConfirm}
        isSubmitting
      />,
    );

    // "Keep" stays disabled while submitting.
    const keep = screen.getByRole('button', {
      name: 'subscriptions.cancelModal.keep',
    });
    expect(keep).toBeDisabled();

    // The confirm button switches to its loading spinner (aria-busy +
    // "app.loading" copy), is disabled, and a click cannot fire onConfirm.
    const confirm = screen.getByRole('button', { name: /app.loading/i });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
