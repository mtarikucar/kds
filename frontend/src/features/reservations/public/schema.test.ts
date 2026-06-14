import { describe, it, expect } from 'vitest';
import {
  step1Schema,
  step2Schema,
  step4Schema,
  reservationFormSchema,
} from './schema';

/**
 * Pure validation specs for the reservation wizard zod schemas. The
 * highest-value branch is step4's cross-field refine: a booking needs
 * EITHER a phone OR an email, and each, when present, must match the
 * E.164-ish / email regex. We assert the exact refine messages and the
 * field path the error attaches to, because the UI keys off them.
 */

function firstIssue(result: ReturnType<typeof step4Schema.safeParse>) {
  if (result.success) return null;
  return result.error.issues[0];
}

describe('step1Schema — date + guestCount bounds', () => {
  it('accepts a valid date with guestCount within 1..100', () => {
    expect(step1Schema.safeParse({ date: '2026-03-01', guestCount: 4 }).success).toBe(true);
  });

  it('rejects an empty date', () => {
    expect(step1Schema.safeParse({ date: '', guestCount: 4 }).success).toBe(false);
  });

  it('rejects guestCount below 1 and above 100', () => {
    expect(step1Schema.safeParse({ date: '2026-03-01', guestCount: 0 }).success).toBe(false);
    expect(step1Schema.safeParse({ date: '2026-03-01', guestCount: 101 }).success).toBe(false);
  });

  it('rejects a non-integer guestCount', () => {
    expect(step1Schema.safeParse({ date: '2026-03-01', guestCount: 2.5 }).success).toBe(false);
  });
});

describe('step2Schema — HH:mm time format', () => {
  it('accepts valid 24h times', () => {
    expect(step2Schema.safeParse({ startTime: '09:00', endTime: '23:59' }).success).toBe(true);
    expect(step2Schema.safeParse({ startTime: '0:05', endTime: '00:30' }).success).toBe(true);
  });

  it('rejects out-of-range hours/minutes and garbage', () => {
    expect(step2Schema.safeParse({ startTime: '24:00', endTime: '10:00' }).success).toBe(false);
    expect(step2Schema.safeParse({ startTime: '10:60', endTime: '10:00' }).success).toBe(false);
    expect(step2Schema.safeParse({ startTime: 'noon', endTime: '10:00' }).success).toBe(false);
  });
});

describe('step4Schema — contact cross-field refine', () => {
  const validBase = { customerName: 'Ada' };

  it('passes with a valid phone and no email', () => {
    const r = step4Schema.safeParse({ ...validBase, customerPhone: '+905551112233' });
    expect(r.success).toBe(true);
  });

  it('passes with a valid email and no phone', () => {
    const r = step4Schema.safeParse({ ...validBase, customerEmail: 'ada@example.com' });
    expect(r.success).toBe(true);
  });

  it('fails (contactRequired on customerPhone) when neither phone nor email is given', () => {
    const r = step4Schema.safeParse({ ...validBase });
    expect(r.success).toBe(false);
    const issue = firstIssue(r);
    expect(issue?.message).toBe('contactRequired');
    expect(issue?.path).toEqual(['customerPhone']);
  });

  it('fails with invalidPhone when the phone is present but malformed', () => {
    const r = step4Schema.safeParse({ ...validBase, customerPhone: '12-34' });
    expect(r.success).toBe(false);
    const messages = r.success ? [] : r.error.issues.map((i) => i.message);
    expect(messages).toContain('invalidPhone');
  });

  it('fails with invalidEmail when the email is present but malformed', () => {
    const r = step4Schema.safeParse({ ...validBase, customerEmail: 'not-an-email' });
    expect(r.success).toBe(false);
    const messages = r.success ? [] : r.error.issues.map((i) => i.message);
    expect(messages).toContain('invalidEmail');
  });

  it('rejects an empty customerName (required, trimmed)', () => {
    const r = step4Schema.safeParse({ customerName: '   ', customerPhone: '+905551112233' });
    expect(r.success).toBe(false);
  });

  it('rejects notes longer than 500 chars', () => {
    const r = step4Schema.safeParse({
      ...validBase,
      customerPhone: '+905551112233',
      notes: 'x'.repeat(501),
    });
    expect(r.success).toBe(false);
  });

  it('accepts an empty-string phone/email as "absent" — but then requires the other', () => {
    // Empty phone alone -> contactRequired (both effectively absent).
    expect(
      step4Schema.safeParse({ ...validBase, customerPhone: '', customerEmail: '' }).success,
    ).toBe(false);
    // Empty phone but valid email -> ok.
    expect(
      step4Schema.safeParse({ ...validBase, customerPhone: '', customerEmail: 'a@b.co' }).success,
    ).toBe(true);
  });
});

describe('reservationFormSchema — merged submit-time schema', () => {
  const full = {
    date: '2026-03-01',
    guestCount: 2,
    startTime: '19:00',
    endTime: '21:00',
    tableId: '',
    customerName: 'Ada',
    customerPhone: '+905551112233',
    customerEmail: '',
    notes: '',
  };

  it('accepts a fully valid wizard payload', () => {
    expect(reservationFormSchema.safeParse(full).success).toBe(true);
  });

  it('still enforces the step4 contact refine after merging all steps', () => {
    const r = reservationFormSchema.safeParse({ ...full, customerPhone: '', customerEmail: '' });
    expect(r.success).toBe(false);
    const messages = r.success ? [] : r.error.issues.map((i) => i.message);
    expect(messages).toContain('contactRequired');
  });

  it('defaults tableId to empty string when omitted', () => {
    const { tableId, ...withoutTable } = full;
    void tableId;
    const r = reservationFormSchema.safeParse(withoutTable);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tableId).toBe('');
  });
});
