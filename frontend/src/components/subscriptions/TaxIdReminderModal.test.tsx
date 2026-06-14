import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TaxIdReminderModal from './TaxIdReminderModal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

// Render Modal's children inline so we can interact with the buttons.
vi.mock('../ui/Modal', () => ({
  default: ({ isOpen, children }: any) => (isOpen ? <div>{children}</div> : null),
}));

describe('TaxIdReminderModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing when closed', () => {
    const { container } = render(
      <TaxIdReminderModal open={false} onContinue={vi.fn()} onSkip={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('proceeds (skip) without navigating when "skip" is clicked', () => {
    const onContinue = vi.fn();
    render(
      <TaxIdReminderModal open onContinue={onContinue} onSkip={vi.fn()} />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'subscriptions.taxIdReminder.skip' }),
    );
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('navigates to the branding settings when "fill now" is clicked', () => {
    render(<TaxIdReminderModal open onContinue={vi.fn()} onSkip={vi.fn()} />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'subscriptions.taxIdReminder.fillNow',
      }),
    );
    expect(navigateMock).toHaveBeenCalledWith('/admin/settings/branding');
  });
});
