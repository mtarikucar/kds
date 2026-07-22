import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { BannerHeader, WizardStepper, ReviewRow, SuccessCard } from './parts';

/**
 * Specs for the reservation wizard presentational parts. Each has real
 * branching worth pinning:
 *   - BannerHeader collapses to null when nothing is set; renders only
 *     the pieces that are present.
 *   - WizardStepper allows click-to-jump ONLY to already-reached steps
 *     that aren't the current one, and renders the progress connector
 *     filled up to furthestReached.
 *   - SuccessCard surfaces the email-only cancel hint conditionally and
 *     links to the lookup page.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && typeof opts.count !== 'undefined' ? `${key}:${opts.count}` : key,
  }),
}));

describe('BannerHeader — conditional collapse', () => {
  it('renders nothing when all four fields are empty', () => {
    const { container } = render(<BannerHeader />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders only the title when only a title is provided (no img/desc/message)', () => {
    render(<BannerHeader title="Book a table" />);
    expect(screen.getByRole('heading', { name: 'Book a table' })).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('renders the banner image and custom message when set', () => {
    render(
      <BannerHeader
        imageUrl="https://x/banner.jpg"
        title="T"
        description="D"
        customMessage="Closed Mondays"
      />,
    );
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://x/banner.jpg');
    expect(screen.getByText('Closed Mondays')).toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
  });
});

describe('WizardStepper — click-to-jump gating', () => {
  it('makes already-reached, non-current steps clickable and others disabled', () => {
    const onJump = vi.fn();
    render(<WizardStepper current={3} furthestReached={4} onJump={onJump} />);
    const buttons = screen.getAllByRole('button');
    // steps 1..5 -> indices 0..4
    expect(buttons[0]).not.toBeDisabled(); // step1 reached, not current
    expect(buttons[2]).toBeDisabled(); // step3 is current -> not clickable
    expect(buttons[3]).not.toBeDisabled(); // step4 reached, not current
    expect(buttons[4]).toBeDisabled(); // step5 not reached
  });

  it('fires onJump with the clicked step number for a reachable step', () => {
    const onJump = vi.fn();
    render(<WizardStepper current={4} furthestReached={4} onJump={onJump} />);
    fireEvent.click(screen.getAllByRole('button')[1]); // step 2
    expect(onJump).toHaveBeenCalledWith(2);
  });

  it('does not fire onJump for an unreached step', () => {
    const onJump = vi.fn();
    render(<WizardStepper current={1} furthestReached={1} onJump={onJump} />);
    fireEvent.click(screen.getAllByRole('button')[3]); // step 4, unreached
    expect(onJump).not.toHaveBeenCalled();
  });

  it('marks the current step with aria-current="step"', () => {
    render(<WizardStepper current={2} furthestReached={3} onJump={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[1]).toHaveAttribute('aria-current', 'step');
    expect(buttons[0]).not.toHaveAttribute('aria-current');
  });
});

describe('ReviewRow — edit affordance', () => {
  it('renders the edit button only when onEdit is provided and calls it', () => {
    const onEdit = vi.fn();
    render(<ReviewRow icon={<span />} label="Date" value="Mar 1" onEdit={onEdit} editLabel="edit" />);
    const btn = screen.getByRole('button', { name: 'edit' });
    fireEvent.click(btn);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('omits the edit button when onEdit is absent', () => {
    render(<ReviewRow icon={<span />} label="Date" value="Mar 1" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('SuccessCard — confirmation + email-only hint', () => {
  const base = {
    reservationNumber: 'RES-12345',
    formattedDate: 'Sunday, March 1, 2026',
    formattedTime: '14:30 — 16:00',
    guestCount: 4,
    lookupHref: '/reserve/t1/lookup',
  };

  function renderCard(
    props: Partial<typeof base> & { status?: string; tableName?: string | null; isEmailOnly: boolean },
  ) {
    return render(
      <MemoryRouter>
        <SuccessCard {...base} {...props} />
      </MemoryRouter>,
    );
  }

  it('renders the reservation number, date, and time prominently', () => {
    renderCard({ isEmailOnly: false });
    expect(screen.getByText('RES-12345')).toBeInTheDocument();
    expect(screen.getByText('Sunday, March 1, 2026')).toBeInTheDocument();
    expect(screen.getByText('14:30 — 16:00')).toBeInTheDocument();
  });

  it('shows the PENDING heading/copy by default (no status / requireApproval)', () => {
    renderCard({ isEmailOnly: false });
    expect(screen.getByText('public.successPending')).toBeInTheDocument();
    expect(screen.getByText('public.successDescription')).toBeInTheDocument();
    expect(screen.queryByText('public.successConfirmed')).not.toBeInTheDocument();
  });

  it('shows the CONFIRMED heading/copy when the reservation is auto-confirmed', () => {
    renderCard({ isEmailOnly: false, status: 'CONFIRMED' });
    expect(screen.getByText('public.successConfirmed')).toBeInTheDocument();
    expect(screen.getByText('public.successConfirmedDescription')).toBeInTheDocument();
    expect(screen.queryByText('public.successPending')).not.toBeInTheDocument();
  });

  it('shows the email-only cancel hint when isEmailOnly is true', () => {
    renderCard({ isEmailOnly: true });
    expect(screen.getByText('public.successEmailOnlyCancelHint')).toBeInTheDocument();
  });

  it('hides the email-only hint when a phone was provided', () => {
    renderCard({ isEmailOnly: false });
    expect(screen.queryByText('public.successEmailOnlyCancelHint')).not.toBeInTheDocument();
  });

  it('renders the tableName line only when provided', () => {
    const { rerender } = renderCard({ isEmailOnly: false, tableName: 'public.table 9' });
    expect(screen.getByText('public.table 9')).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <SuccessCard {...base} isEmailOnly={false} tableName={null} />
      </MemoryRouter>,
    );
    expect(screen.queryByText('public.table 9')).not.toBeInTheDocument();
  });

  it('links the lookup CTA to the provided href', () => {
    renderCard({ isEmailOnly: false });
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/reserve/t1/lookup');
  });
});
