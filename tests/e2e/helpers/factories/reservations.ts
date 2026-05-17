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
    const payload = {
      date: input.date ?? tomorrowISO(),
      startTime: input.startTime ?? '19:00',
      endTime: input.endTime ?? '20:30',
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
