import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CardShiftTab from './CardShiftTab';

/**
 * The enrolment table is the one screen that could leak a card UID. It must
 * show the last four digits and nothing else, and revoking has to be a
 * deliberate act: a revoked card locks a staff member out of the kiosk until
 * an admin re-enrols them.
 */
let assignments: any[];
const assignAsync = vi.fn();
const revokeAsync = vi.fn();

vi.mock('../../features/personnel/personnelApi', () => ({
  useCardAssignments: () => ({ data: assignments, isLoading: false }),
  useAssignCard: () => ({ mutateAsync: assignAsync, isPending: false }),
  useRevokeCard: () => ({ mutateAsync: revokeAsync, isPending: false }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, arg?: any) =>
      arg && typeof arg === 'object' && Object.keys(arg).length
        ? `${key}::${Object.values(arg).join(',')}`
        : key,
  }),
}));

vi.mock('react-router-dom', () => ({
  // Mirror real react-router: `to` becomes the anchor's `href`. A pass-through
  // mock (`<a {...rest}>`) would leave `to` as a non-standard attribute and no
  // test could ever observe where the link actually goes.
  Link: ({ children, to, ...rest }: any) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  assignAsync.mockReset().mockResolvedValue({});
  revokeAsync.mockReset().mockResolvedValue({});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  assignments = [
    {
      userId: 'u-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      role: 'WAITER',
      last4: '2B9C',
      assignedAt: '2026-08-20T10:00:00.000Z',
      assignedById: 'u-admin',
    },
    {
      userId: 'u-2',
      firstName: 'Grace',
      lastName: 'Hopper',
      role: 'KITCHEN',
      last4: null,
      assignedAt: null,
      assignedById: null,
    },
  ];
});

describe('CardShiftTab', () => {
  it('lists only the last 4 digits, never a full UID', () => {
    render(<CardShiftTab />);
    expect(screen.getByText('•••• 2B9C')).toBeInTheDocument();
    expect(screen.getByText('personnel:cardShift.noCard')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('04A22B9C');
  });

  it('sends the typed UID on submit and clears the field', async () => {
    render(<CardShiftTab />);
    fireEvent.click(screen.getAllByText('personnel:cardShift.assign')[1]);
    const input = screen.getByLabelText('personnel:cardShift.tapPrompt') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '04:A2:2B:9C' } });
    fireEvent.submit(input.closest('form')!);

    expect(assignAsync).toHaveBeenCalledWith({
      userId: 'u-2',
      cardUid: '04:A2:2B:9C',
    });
    // The UID must not linger anywhere in the document after submit. The row
    // collapses back to its buttons view on submit (so the input itself is
    // unmounted, not merely blanked) — checking body text catches either
    // implementation and is what actually matters for a credential.
    expect(document.body.textContent).not.toContain('04:A2:2B:9C');
    expect(screen.queryByLabelText('personnel:cardShift.tapPrompt')).not.toBeInTheDocument();
  });

  it('asks for confirmation before revoking', () => {
    render(<CardShiftTab />);
    fireEvent.click(screen.getByText('personnel:cardShift.revoke'));

    expect(window.confirm).toHaveBeenCalledWith(
      'personnel:cardShift.revokeConfirm::Ada Lovelace',
    );
    expect(revokeAsync).toHaveBeenCalledWith('u-1');
  });

  it('does not revoke when the confirmation is declined', () => {
    (window.confirm as any).mockReturnValue(false);
    render(<CardShiftTab />);
    fireEvent.click(screen.getByText('personnel:cardShift.revoke'));

    expect(revokeAsync).not.toHaveBeenCalled();
  });

  it('links to the station screen — the kiosk tablet is opened from here', () => {
    render(<CardShiftTab />);
    const link = screen.getByText('personnel:cardShift.openStation').closest('a')!;
    expect(link.getAttribute('href')).toBe('/card-shift');
  });
});
