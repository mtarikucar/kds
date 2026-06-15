import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useForm, FormProvider, type UseFormReturn } from 'react-hook-form';
import type { ReactNode } from 'react';
import type { ReservationFormValues } from './types';
import type { AvailableSlot, AvailableTable } from '../../../types';
import { Step1DateAndGuests, Step2TimeSlots, Step3Table, Step4Contact } from './steps';

/**
 * Real specs for the public reservation wizard steps. These drive the
 * actual components inside a live react-hook-form FormProvider and assert
 * on the branching that matters:
 *   - Step1: guest-count grid is capped at min(maxGuests, 20); clicking a
 *     pill writes guestCount into the form.
 *   - Step2: the slot list hides unavailable slots AND past slots for
 *     today (defense-in-depth past-time guard); selecting a slot computes
 *     endTime = start + defaultDuration with wrap/pad.
 *   - Step3: "Any table" + table grid selection write tableId.
 *   - Step4: the cross-field contactRequired error renders its own
 *     banner, while a bad-format phone shows the format error instead.
 *
 * i18n('reservations') isn't in the test setup allow-list, so we mock
 * react-i18next to echo keys (with interpolation) — assertions target
 * keys/values, never localized prose.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && typeof opts.count !== 'undefined' ? `${key}:${opts.count}` : key,
    // PhoneInput (rendered inside Step4) reads i18n.language for its
    // country-list localization, so the mock must expose it.
    i18n: { language: 'tr' },
  }),
}));

// Capture the live form so tests can read form values written by the unit.
let formRef: UseFormReturn<ReservationFormValues>;

function Harness({
  children,
  defaults,
}: {
  children: ReactNode;
  defaults?: Partial<ReservationFormValues>;
}) {
  const form = useForm<ReservationFormValues>({
    mode: 'onChange',
    defaultValues: {
      date: '',
      guestCount: 2,
      startTime: '',
      endTime: '',
      tableId: '',
      customerName: '',
      customerPhone: '',
      customerEmail: '',
      notes: '',
      ...defaults,
    },
  });
  formRef = form;
  return <FormProvider {...form}>{children}</FormProvider>;
}

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Step1DateAndGuests — guest count grid', () => {
  it('caps the grid at min(maxGuests, 20)', () => {
    render(
      <Harness>
        <Step1DateAndGuests minDate="2026-06-14" maxDate="2026-07-14" maxGuests={50} />
      </Harness>,
    );
    // pills are numbered buttons 1..20 when maxGuests exceeds 20
    expect(screen.getByRole('button', { name: '20' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '21' })).not.toBeInTheDocument();
  });

  it('renders exactly maxGuests pills when below the cap', () => {
    render(
      <Harness>
        <Step1DateAndGuests minDate="2026-06-14" maxDate="2026-07-14" maxGuests={4} />
      </Harness>,
    );
    expect(screen.getByRole('button', { name: '4' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '5' })).not.toBeInTheDocument();
  });

  it('clicking a pill writes guestCount into the form', () => {
    render(
      <Harness>
        <Step1DateAndGuests minDate="2026-06-14" maxDate="2026-07-14" maxGuests={10} />
      </Harness>,
    );
    fireEvent.click(screen.getByRole('button', { name: '6' }));
    expect(formRef.getValues('guestCount')).toBe(6);
  });

  it('passes min/max bounds to the date input', () => {
    const { container } = render(
      <Harness>
        <Step1DateAndGuests minDate="2026-06-14" maxDate="2026-07-14" maxGuests={10} />
      </Harness>,
    );
    const date = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(date.min).toBe('2026-06-14');
    expect(date.max).toBe('2026-07-14');
  });
});

describe('Step2TimeSlots — availability + past-time filtering', () => {
  const slots: AvailableSlot[] = [
    { time: '09:00', available: true },
    { time: '12:00', available: false }, // backend marked unavailable -> hidden
    { time: '20:00', available: true },
  ] as AvailableSlot[];

  it('shows a loading spinner and no slot buttons while loading', () => {
    const { container } = render(
      <Harness>
        <Step2TimeSlots slots={undefined} isLoading defaultDuration={60} date="2026-06-20" />
      </Harness>,
    );
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders the empty state when every slot is filtered out', () => {
    render(
      <Harness>
        <Step2TimeSlots
          slots={[{ time: '09:00', available: false }] as AvailableSlot[]}
          isLoading={false}
          defaultDuration={60}
          date="2026-06-20"
        />
      </Harness>,
    );
    expect(screen.getByText('public.slots.empty')).toBeInTheDocument();
  });

  it('hides backend-unavailable slots but keeps available ones for a future date', () => {
    render(
      <Harness>
        <Step2TimeSlots slots={slots} isLoading={false} defaultDuration={60} date="2999-01-01" />
      </Harness>,
    );
    // 09:00 and 20:00 available; 12:00 unavailable -> hidden.
    // formatTime is NOT mocked (real util), so labels are 12h.
    expect(screen.getByRole('button', { name: '9:00 AM' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '8:00 PM' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '12:00 PM' })).not.toBeInTheDocument();
  });

  it('drops past slots when the chosen date is today (defense-in-depth)', () => {
    // Freeze "now" to today 13:00 local. 09:00 is in the past -> dropped,
    // 20:00 is in the future -> kept.
    vi.useFakeTimers();
    const now = new Date();
    now.setHours(13, 0, 0, 0);
    vi.setSystemTime(now);
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    render(
      <Harness>
        <Step2TimeSlots
          slots={[
            { time: '09:00', available: true },
            { time: '20:00', available: true },
          ] as AvailableSlot[]}
          isLoading={false}
          defaultDuration={60}
          date={todayStr}
        />
      </Harness>,
    );
    expect(screen.queryByRole('button', { name: '9:00 AM' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '8:00 PM' })).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('selecting a slot sets startTime and endTime = start + defaultDuration', () => {
    render(
      <Harness>
        <Step2TimeSlots
          slots={[{ time: '20:00', available: true }] as AvailableSlot[]}
          isLoading={false}
          defaultDuration={90}
          date="2999-01-01"
        />
      </Harness>,
    );
    fireEvent.click(screen.getByRole('button', { name: '8:00 PM' }));
    expect(formRef.getValues('startTime')).toBe('20:00');
    expect(formRef.getValues('endTime')).toBe('21:30'); // +90 min
  });

  it('wraps endTime past midnight using modulo-24 arithmetic', () => {
    render(
      <Harness>
        <Step2TimeSlots
          slots={[{ time: '23:30', available: true }] as AvailableSlot[]}
          isLoading={false}
          defaultDuration={60}
          date="2999-01-01"
        />
      </Harness>,
    );
    fireEvent.click(screen.getByRole('button', { name: '11:30 PM' }));
    expect(formRef.getValues('endTime')).toBe('00:30');
  });
});

describe('Step3Table — table selection', () => {
  const tables: AvailableTable[] = [
    { id: 't-1', number: '5', capacity: 4, section: 'Patio' },
    { id: 't-2', number: '9', capacity: 2 },
  ];

  it('shows a spinner while loading', () => {
    const { container } = render(
      <Harness>
        <Step3Table tables={undefined} isLoading />
      </Harness>,
    );
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('clicking a table writes its id; "Any table" clears it back to empty', () => {
    render(
      <Harness defaults={{ tableId: '' }}>
        <Step3Table tables={tables} isLoading={false} />
      </Harness>,
    );
    fireEvent.click(screen.getByRole('button', { name: /public\.table 5/ }));
    expect(formRef.getValues('tableId')).toBe('t-1');

    fireEvent.click(screen.getByRole('button', { name: /public\.anyTable/ }));
    expect(formRef.getValues('tableId')).toBe('');
  });
});

describe('Step4Contact — contact validation display', () => {
  it('renders the contactRequired banner when that refine error is set on customerPhone', () => {
    render(
      <Harness>
        <Step4Contact />
      </Harness>,
    );
    // Simulate the zod refine surfacing on customerPhone. setError mutates
    // RHF state — wrap in act so the error flushes to the rendered output.
    act(() => {
      formRef.setError('customerPhone', { type: 'manual', message: 'contactRequired' });
    });

    expect(screen.getByText('public.validation.contactRequired')).toBeInTheDocument();
    // The format error must NOT show for the contactRequired message.
    expect(screen.queryByText('public.validation.phoneInvalid')).not.toBeInTheDocument();
  });

  it('renders the phone-format error (not the contact banner) for an invalid phone', () => {
    render(
      <Harness>
        <Step4Contact />
      </Harness>,
    );
    act(() => {
      formRef.setError('customerPhone', { type: 'manual', message: 'invalidPhone' });
    });

    expect(screen.getByText('public.validation.phoneInvalid')).toBeInTheDocument();
    expect(screen.queryByText('public.validation.contactRequired')).not.toBeInTheDocument();
  });

  it('wires PhoneInput so typing a natural number stores canonical E.164', () => {
    render(
      <Harness>
        <Step4Contact />
      </Harness>,
    );
    // PhoneInput renders the national-number field as the type=tel input
    // (the country selector is a separate <select>). Typing a Turkish
    // national number emits canonical E.164 into the form via Controller.
    const tel = document.querySelector('input[type="tel"]') as HTMLInputElement;
    fireEvent.change(tel, { target: { value: '0555 111 22 33' } });
    expect(formRef.getValues('customerPhone')).toBe('+905551112233');
  });
});
