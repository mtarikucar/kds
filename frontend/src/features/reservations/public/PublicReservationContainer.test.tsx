import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AvailableSlot, AvailableTable, Reservation } from '../../../types';

/**
 * Integration specs for the public reservation wizard container. We mock
 * every api-hook so we can pin the container's own logic:
 *   - settings loading / disabled / error gates,
 *   - branch picker visibility + default selection,
 *   - step gating via the real zodResolver (can't advance past step1 with
 *     an empty date; can with a valid one),
 *   - the submit payload's conditional spreads (phone/email/notes/table/
 *     branch only included when truthy),
 *   - the success card after a resolved create mutation, including the
 *     email-only hint branch when no phone was supplied.
 *
 * react-i18next is mocked to echo keys (with {count}) so we can target
 * buttons/labels by stable key rather than localized prose.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && typeof opts.count !== 'undefined' ? `${key}:${opts.count}` : key,
  }),
}));

// ---- api-hook mocks -------------------------------------------------------
const settingsState = { data: undefined as unknown, isLoading: false, error: null as unknown };
const branchesState = { data: undefined as unknown };
const slotsState = { data: undefined as unknown, isLoading: false };
const tablesState = { data: undefined as unknown, isLoading: false };
const mutateAsyncMock = vi.fn();
const createState = { mutateAsync: mutateAsyncMock, isPending: false };

vi.mock('../publicReservationsApi', () => ({
  usePublicReservationSettings: () => settingsState,
  usePublicBranches: () => branchesState,
  useAvailableSlots: () => slotsState,
  useAvailableTables: () => tablesState,
  useCreatePublicReservation: () => createState,
}));

import PublicReservationContainer from './PublicReservationContainer';

function renderContainer() {
  return render(
    <MemoryRouter initialEntries={['/reserve/tenant-1']}>
      <Routes>
        <Route path="/reserve/:tenantId" element={<PublicReservationContainer />} />
      </Routes>
    </MemoryRouter>,
  );
}

const enabledSettings = {
  isEnabled: true,
  maxAdvanceDays: 30,
  maxGuestsPerReservation: 10,
  defaultDuration: 60,
  bannerTitle: 'Book with us',
};

function resetState() {
  settingsState.data = undefined;
  settingsState.isLoading = false;
  settingsState.error = null;
  branchesState.data = undefined;
  slotsState.data = undefined;
  slotsState.isLoading = false;
  tablesState.data = undefined;
  tablesState.isLoading = false;
  createState.isPending = false;
  mutateAsyncMock.mockReset();
}

beforeEach(resetState);

describe('PublicReservationContainer — top-level gates', () => {
  it('shows a spinner while settings are loading', () => {
    settingsState.isLoading = true;
    const { container } = renderContainer();
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows the unavailable card when reservations are disabled', () => {
    settingsState.data = { isEnabled: false };
    renderContainer();
    expect(screen.getByText('public.unavailable.title')).toBeInTheDocument();
    expect(screen.queryByText('public.next')).not.toBeInTheDocument();
  });

  it('shows the unavailable card on a settings error', () => {
    settingsState.error = new Error('boom');
    renderContainer();
    expect(screen.getByText('public.unavailable.title')).toBeInTheDocument();
  });

  it('renders the wizard (step 1 with Next) when enabled', () => {
    settingsState.data = enabledSettings;
    renderContainer();
    expect(screen.getByText('public.next')).toBeInTheDocument();
    expect(screen.getByText('Book with us')).toBeInTheDocument();
  });
});

describe('PublicReservationContainer — branch picker', () => {
  it('hides the branch <select> for a single-branch tenant', () => {
    settingsState.data = enabledSettings;
    branchesState.data = [{ id: 'br-1', name: 'Main' }];
    const { container } = renderContainer();
    expect(container.querySelector('#branch-select')).toBeNull();
  });

  it('renders the branch <select> and defaults to the first branch when multiple', () => {
    settingsState.data = enabledSettings;
    branchesState.data = [
      { id: 'br-1', name: 'Main' },
      { id: 'br-2', name: 'Annex' },
    ];
    const { container } = renderContainer();
    const select = container.querySelector('#branch-select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('br-1'); // defaults to first (oldest-active)
    expect(within(select).getByRole('option', { name: 'Annex' })).toBeInTheDocument();
  });
});

describe('PublicReservationContainer — step gating', () => {
  it('blocks advancing from step 1 while the date is empty', async () => {
    settingsState.data = enabledSettings;
    renderContainer();
    fireEvent.click(screen.getByText('public.next'));
    // still on step 1: the date label is present, time-step heading is not.
    await waitFor(() => {
      expect(screen.getByText('public.selectDate')).toBeInTheDocument();
    });
    expect(screen.queryByText('public.selectTime')).not.toBeInTheDocument();
  });

  it('advances to the time step once a valid date is entered', async () => {
    settingsState.data = enabledSettings;
    slotsState.data = [{ time: '19:00', available: true }] as AvailableSlot[];
    const { container } = renderContainer();

    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2999-01-01' } });
    fireEvent.click(screen.getByText('public.next'));

    await waitFor(() => {
      expect(screen.getByText('public.selectTime')).toBeInTheDocument();
    });
  });
});

describe('PublicReservationContainer — submit payload + success', () => {
  async function driveToReview(container: HTMLElement, opts: { withPhone: boolean }) {
    // Step 1: date + (default guestCount 2)
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2999-01-01' } });
    fireEvent.click(screen.getByText('public.next'));

    // Step 2: pick the only slot (sets start/end).
    await screen.findByText('public.selectTime');
    fireEvent.click(screen.getByText('7:00 PM'));
    fireEvent.click(screen.getByText('public.next'));

    // Step 3: table (optional) — pick the offered table.
    await screen.findByText('public.selectTable');
    fireEvent.click(screen.getByText(/public\.table 12/));
    fireEvent.click(screen.getByText('public.next'));

    // Step 4: contact.
    await screen.findByText('public.yourInfo');
    fireEvent.input(container.querySelector('input[autocomplete="name"]')!, {
      target: { value: 'Ada Lovelace' },
    });
    if (opts.withPhone) {
      fireEvent.input(container.querySelector('input[type="tel"]')!, {
        target: { value: '+905551112233' },
      });
    } else {
      fireEvent.input(container.querySelector('input[type="email"]')!, {
        target: { value: 'ada@example.com' },
      });
    }
    fireEvent.input(container.querySelector('textarea')!, {
      target: { value: 'window seat please' },
    });
    fireEvent.click(screen.getByText('public.next'));

    await screen.findByText('public.review.title');
  }

  beforeEach(() => {
    settingsState.data = enabledSettings;
    branchesState.data = [{ id: 'br-1', name: 'Main' }];
    slotsState.data = [{ time: '19:00', available: true }] as AvailableSlot[];
    tablesState.data = [
      { id: 'tbl-12', number: '12', capacity: 4 },
    ] as AvailableTable[];
  });

  it('builds a payload with phone/notes/table/branch and renders the success card', async () => {
    const created: Reservation = {
      reservationNumber: 'RES-99',
    } as Reservation;
    mutateAsyncMock.mockResolvedValue(created);

    const { container } = renderContainer();
    await driveToReview(container, { withPhone: true });

    fireEvent.click(screen.getByText('public.submit'));

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1));
    const arg = mutateAsyncMock.mock.calls[0][0];
    expect(arg.tenantId).toBe('tenant-1');
    expect(arg.data).toMatchObject({
      date: '2999-01-01',
      startTime: '19:00',
      endTime: '20:00', // +60 default duration
      guestCount: 2,
      customerName: 'Ada Lovelace',
      customerPhone: '+905551112233',
      notes: 'window seat please',
      tableId: 'tbl-12',
      branchId: 'br-1',
    });
    // No email was typed -> the key must be omitted, not sent empty.
    expect('customerEmail' in arg.data).toBe(false);

    // Success card shows the confirmation number.
    await waitFor(() => expect(screen.getByText('RES-99')).toBeInTheDocument());
  });

  it('omits customerPhone and shows the email-only hint when only email is given', async () => {
    mutateAsyncMock.mockResolvedValue({ reservationNumber: 'RES-100' } as Reservation);

    const { container } = renderContainer();
    await driveToReview(container, { withPhone: false });

    fireEvent.click(screen.getByText('public.submit'));

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1));
    const { data } = mutateAsyncMock.mock.calls[0][0];
    expect('customerPhone' in data).toBe(false);
    expect(data.customerEmail).toBe('ada@example.com');

    // Email-only cancel hint surfaces on the success card.
    await waitFor(() =>
      expect(screen.getByText('public.successEmailOnlyCancelHint')).toBeInTheDocument(),
    );
  });

  it('does not crash or show success when the create mutation rejects', async () => {
    mutateAsyncMock.mockRejectedValue(new Error('server down'));

    const { container } = renderContainer();
    await driveToReview(container, { withPhone: true });
    fireEvent.click(screen.getByText('public.submit'));

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalled());
    // Stays on the review step (no success number rendered).
    expect(screen.queryByText('RES-99')).not.toBeInTheDocument();
    expect(screen.getByText('public.review.title')).toBeInTheDocument();
  });
});
