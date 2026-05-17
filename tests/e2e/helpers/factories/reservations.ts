import { APIRequestContext, request } from '@playwright/test';
import { API_BASE } from '../api';

export type ReservationInput = {
  date?: string; // YYYY-MM-DD; defaults to tomorrow
  startTime?: string;
  endTime?: string;
  guestCount?: number;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  notes?: string;
  tableId?: string;
};

export type ReservationResult = {
  id: string;
  reservationNumber: string;
  status: string;
  customerName: string;
  customerPhone: string;
};

function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Pick a random {start, end} slot inside a wide operating window. Used
 * as the default for createPublicReservation so concurrent test runs
 * don't pile onto the same slot and trip `maxReservationsPerSlot`. End
 * time = start + 90 minutes (matches the seed defaultDuration).
 */
function randomSlot(): { startTime: string; endTime: string } {
  // 12:00 .. 21:00 in 30-minute steps → 19 possible starts.
  const idx = Math.floor(Math.random() * 19);
  const startMinutes = 12 * 60 + idx * 30;
  const endMinutes = startMinutes + 90;
  const fmt = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return { startTime: fmt(startMinutes), endTime: fmt(endMinutes) };
}

/**
 * Public reservation endpoint — no auth, but requires tenantId in the
 * path. Returns a confirmation number the cancel-endpoint pairs with
 * the phone for lookup.
 */
export async function createPublicReservation(
  tenantId: string,
  input: ReservationInput = {},
): Promise<ReservationResult> {
  const ctx = await request.newContext({ baseURL: API_BASE });
  try {
    const ts = Date.now().toString();
    const slot = randomSlot();
    const payload = {
      date: input.date ?? tomorrowISO(),
      startTime: input.startTime ?? slot.startTime,
      endTime: input.endTime ?? slot.endTime,
      guestCount: input.guestCount ?? 2,
      customerName: input.customerName ?? `E2E Reserve ${ts}`,
      customerPhone: input.customerPhone ?? `+905${ts.slice(-9)}`,
      customerEmail: input.customerEmail,
      notes: input.notes,
      tableId: input.tableId,
    };
    const res = await ctx.post(`public/reservations/${tenantId}`, { data: payload });
    if (!res.ok())
      throw new Error(`createPublicReservation failed: ${res.status()} ${await res.text()}`);
    return res.json();
  } finally {
    await ctx.dispose();
  }
}

export async function confirmReservation(
  api: APIRequestContext,
  reservationId: string,
): Promise<void> {
  const res = await api.patch(`reservations/${reservationId}/confirm`);
  if (!res.ok())
    throw new Error(`confirmReservation failed: ${res.status()} ${await res.text()}`);
}

export async function rejectReservation(
  api: APIRequestContext,
  reservationId: string,
): Promise<void> {
  const res = await api.patch(`reservations/${reservationId}/reject`);
  if (!res.ok())
    throw new Error(`rejectReservation failed: ${res.status()} ${await res.text()}`);
}

export async function markNoShow(api: APIRequestContext, reservationId: string): Promise<void> {
  const res = await api.patch(`reservations/${reservationId}/no-show`);
  if (!res.ok()) throw new Error(`markNoShow failed: ${res.status()} ${await res.text()}`);
}
