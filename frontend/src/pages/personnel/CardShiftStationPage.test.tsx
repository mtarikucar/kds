import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import CardShiftStationPage from './CardShiftStationPage';

/**
 * The kiosk. Nobody is logged in as themselves here — a staff member walks up,
 * taps, and reads one line of large type. Three things therefore matter:
 * the hidden input must ALWAYS have focus (a reader types into whatever has
 * focus; a blurred field sends the UID into the void), the field must be
 * cleared after every tap, and a rejected card must never echo its number back
 * onto a screen standing in a corridor.
 */
const tapAsync = vi.fn();

vi.mock('../../features/personnel/personnelApi', () => ({
  useCardTap: () => ({ mutateAsync: tapAsync, isPending: false }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, arg?: any) =>
      arg && typeof arg === 'object' && Object.keys(arg).length
        ? `${key}::${Object.values(arg).join(',')}`
        : key,
  }),
}));

const hiddenInput = () =>
  screen.getByLabelText('personnel:cardShift.tapPrompt') as HTMLInputElement;

const type = (value: string) => {
  const input = hiddenInput();
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
  return input;
};

beforeEach(() => {
  tapAsync.mockReset().mockResolvedValue({
    action: 'clockIn',
    user: { id: 'u-1', firstName: 'Ada', lastName: 'Lovelace', role: 'WAITER' },
    attendance: { id: 'a-1', clockIn: '2026-08-20T09:03:00.000Z' },
  });
});

afterEach(() => vi.useRealTimers());

describe('CardShiftStationPage', () => {
  it('posts the typed UID on Enter and clears the input', async () => {
    render(<CardShiftStationPage />);
    const input = type('04:A2:2B:9C');

    expect(tapAsync).toHaveBeenCalledWith({ cardUid: '04:A2:2B:9C' });
    await act(async () => undefined);
    expect(input.value).toBe('');
  });

  it('shows the staff name and action on success', async () => {
    render(<CardShiftStationPage />);
    type('04A22B9C');
    await act(async () => undefined);

    expect(
      screen.getByText(/personnel:cardShift\.station\.welcome::Ada Lovelace/),
    ).toBeInTheDocument();
  });

  it('shows an unrecognised-card message without echoing the UID', async () => {
    tapAsync.mockRejectedValue({
      response: { status: 404, data: { code: 'CARD_NOT_RECOGNISED' } },
    });
    render(<CardShiftStationPage />);
    type('04A22B9C');
    await act(async () => undefined);

    expect(
      screen.getByText('personnel:cardShift.errors.notRecognised'),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('04A22B9C');
  });

  it('maps a 409 to the already-clocked-out message', async () => {
    tapAsync.mockRejectedValue({
      response: { status: 409, data: { code: 'ALREADY_CLOCKED_OUT_TODAY' } },
    });
    render(<CardShiftStationPage />);
    type('04A22B9C');
    await act(async () => undefined);

    expect(
      screen.getByText('personnel:cardShift.errors.alreadyClockedOut'),
    ).toBeInTheDocument();
  });

  it('reports an ignored tap as a notice, not as a punch', async () => {
    tapAsync.mockResolvedValue({
      action: 'ignored',
      user: { id: 'u-1', firstName: 'Ada', lastName: 'Lovelace', role: 'WAITER' },
      attendance: null,
    });
    render(<CardShiftStationPage />);
    type('04A22B9C');
    await act(async () => undefined);

    expect(
      screen.getByText('personnel:cardShift.station.ignored'),
    ).toBeInTheDocument();
  });

  it('refocuses the hidden input after a blur', () => {
    render(<CardShiftStationPage />);
    const input = hiddenInput();
    input.blur();
    fireEvent.blur(input);
    expect(document.activeElement).toBe(input);
  });

  it('locks the screen after 60s of inactivity', () => {
    vi.useFakeTimers();
    render(<CardShiftStationPage />);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('personnel:cardShift.station.locked')).toBeInTheDocument();
  });
});
