import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AttendanceTab from './AttendanceTab';

/**
 * The source badge is the only UI surface that tells a manager which
 * clock-ins came from the RFID reader vs. the app. Since AttendanceSource is
 * a plain string (not covered by check-contract-drift.mjs — see the
 * `clockInSource` type comment), an unrecognised value must fall through to
 * the "App" badge instead of rendering blank or throwing.
 */
let historyRows: any[];
let summaryRows: any[];

vi.mock('../../features/personnel/personnelApi', () => ({
  useMyAttendanceStatus: () => ({ data: { status: 'NOT_CLOCKED_IN', date: '2026-08-20' } }),
  useAttendanceToday: () => ({ data: [], isLoading: false }),
  useAttendanceList: () => ({
    data: { data: historyRows, meta: { total: historyRows.length, page: 1, totalPages: 1 } },
    isLoading: false,
  }),
  useAttendanceSummary: () => ({ data: summaryRows, isLoading: false }),
  useClockIn: () => ({ mutate: vi.fn(), isPending: false }),
  useClockOut: () => ({ mutate: vi.fn(), isPending: false }),
  useStartBreak: () => ({ mutate: vi.fn(), isPending: false }),
  useEndBreak: () => ({ mutate: vi.fn(), isPending: false }),
  downloadAttendanceSummaryCsv: vi.fn(),
}));

vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector: any) => selector({ user: { id: 'u-admin', role: 'ADMIN' } }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  historyRows = [
    {
      id: 'a-card',
      date: '2026-08-20',
      clockIn: '2026-08-20T09:00:00.000Z',
      clockOut: '2026-08-20T17:00:00.000Z',
      totalWorkedMinutes: 480,
      overtimeMinutes: 0,
      isLate: false,
      lateMinutes: 0,
      clockInSource: 'card',
      user: { id: 'u-1', firstName: 'Ada', lastName: 'Lovelace', role: 'WAITER' },
    },
    {
      id: 'a-manual',
      date: '2026-08-20',
      clockIn: '2026-08-20T09:05:00.000Z',
      clockOut: '2026-08-20T17:05:00.000Z',
      totalWorkedMinutes: 480,
      overtimeMinutes: 0,
      isLate: false,
      lateMinutes: 0,
      clockInSource: 'manual',
      user: { id: 'u-2', firstName: 'Grace', lastName: 'Hopper', role: 'KITCHEN' },
    },
    {
      id: 'a-unknown',
      date: '2026-08-20',
      clockIn: '2026-08-20T09:10:00.000Z',
      clockOut: '2026-08-20T17:10:00.000Z',
      totalWorkedMinutes: 480,
      overtimeMinutes: 0,
      isLate: false,
      lateMinutes: 0,
      // Deliberately not 'card' and not 'manual' — an unrecognised future
      // value must still degrade to the "App" badge, not blank or throw.
      clockInSource: 'something-new',
      user: { id: 'u-3', firstName: 'Alan', lastName: 'Turing', role: 'ADMIN' },
    },
  ];
  summaryRows = [
    {
      user: { id: 'u-1', firstName: 'Ada', lastName: 'Lovelace', role: 'WAITER' },
      totalDays: 5,
      totalWorkedMinutes: 2400,
      totalBreakMinutes: 150,
      totalOvertimeMinutes: 0,
      lateDays: 0,
      totalLateMinutes: 0,
      cardClockIns: 3,
    },
  ];
});

describe('AttendanceTab — card shift source badge + summary column', () => {
  it('badges a card clock-in as "Kart" and a manual one as "Uygulama"', () => {
    render(<AttendanceTab />);
    fireEvent.click(screen.getByText('attendance.history'));

    // sourceCard / sourceManual keys resolve through the mocked t(key) => key.
    // The column header also reads "cardShift.sourceCard" (same key as the
    // badge, per spec), so scope to <span> badges only — not the <th>.
    const cardBadges = screen.getAllByText('cardShift.sourceCard', { selector: 'span' });
    const appBadges = screen.getAllByText('cardShift.sourceManual', { selector: 'span' });
    expect(cardBadges).toHaveLength(1);
    // 'manual' AND the unrecognised 'something-new' both fall through to App.
    expect(appBadges).toHaveLength(2);
  });

  it('shows the per-staff card clock-in count in the summary table', () => {
    render(<AttendanceTab />);
    fireEvent.click(screen.getByText('attendance.summary'));

    const row = screen.getByText('Ada Lovelace').closest('tr')!;
    expect(row.textContent).toContain('3');
  });
});
