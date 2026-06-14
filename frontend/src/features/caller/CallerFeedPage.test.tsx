import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CallerEvent } from './callerApi';

// CallerFeedPage renders the recent-calls table from useListCallerEvents.
// We mock the query hook so each test pins loading/empty/data, and assert:
// matched calls link to the customer + order, unmatched calls show the
// "unmatched" copy, durations are rounded to seconds, and the kind pill takes
// the right colour. Uses the `common` namespace (loaded by the shared setup).

const state: { data: CallerEvent[]; isLoading: boolean } = { data: [], isLoading: false };
vi.mock('./callerApi', () => ({
  useListCallerEvents: () => state,
}));

import CallerFeedPage from './CallerFeedPage';

function makeEvent(over: Partial<CallerEvent> = {}): CallerEvent {
  return {
    id: 'c-1',
    tenantId: 't-1',
    providerId: 'netgsm',
    callId: 'call-1',
    kind: 'incoming',
    e164: '+905551234567',
    customerId: null,
    durationMs: null,
    occurredAt: '2026-06-14T10:00:00Z',
    orderId: null,
    ...over,
  };
}

function renderFeed() {
  return render(
    <MemoryRouter>
      <CallerFeedPage />
    </MemoryRouter>,
  );
}

describe('CallerFeedPage', () => {
  beforeEach(() => {
    state.data = [];
    state.isLoading = false;
  });

  it('shows the loading line while the feed query is pending', () => {
    state.isLoading = true;
    renderFeed();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the empty state when there are no recent calls', () => {
    state.data = [];
    renderFeed();
    // common.hummytummy.callerFeed.empty
    expect(
      screen.getByText(/No call events yet\. Pair a caller-ID device/),
    ).toBeInTheDocument();
  });

  it('links a matched call to the customer detail page', () => {
    state.data = [makeEvent({ customerId: 'cust-9', e164: '+905550001122' })];
    renderFeed();
    const link = screen.getByRole('link', { name: 'View' });
    expect(link).toHaveAttribute('href', '/customers/cust-9');
  });

  it('shows the unmatched label (no link) for an unmatched call', () => {
    state.data = [makeEvent({ customerId: null })];
    renderFeed();
    expect(screen.getByText('unmatched')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View' })).not.toBeInTheDocument();
  });

  it('links to POS with the orderId when the call produced an order', () => {
    state.data = [makeEvent({ orderId: 'ord-77' })];
    renderFeed();
    const open = screen.getByRole('link', { name: 'Open' });
    expect(open).toHaveAttribute('href', '/pos?orderId=ord-77');
  });

  it('rounds durationMs to whole seconds and shows em-dash when absent', () => {
    state.data = [
      makeEvent({ id: 'a', e164: '+900000000001', durationMs: 95_400 }), // -> 95s
      makeEvent({ id: 'b', e164: '+900000000002', durationMs: null }), // -> —
    ];
    renderFeed();
    expect(screen.getByText('95s')).toBeInTheDocument();

    // The null-duration row renders "—" for both the duration cell and the
    // (also-absent) order cell.
    const row = screen.getByText('+900000000002').closest('tr')!;
    expect(within(row).getAllByText('—').length).toBe(2);
  });

  it('colours the kind pill: missed -> amber, answered -> green', () => {
    state.data = [
      makeEvent({ id: 'a', kind: 'missed', e164: '+900000000001' }),
      makeEvent({ id: 'b', kind: 'answered', e164: '+900000000002' }),
    ];
    renderFeed();
    expect(screen.getByText('missed').className).toContain('bg-amber-100');
    expect(screen.getByText('answered').className).toContain('bg-green-100');
  });

  it('renders the e164 as plain text when present', () => {
    state.data = [makeEvent({ e164: '+905559998877' })];
    renderFeed();
    expect(screen.getByText('+905559998877')).toBeInTheDocument();
  });
});
