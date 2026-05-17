import { APIRequestContext } from '@playwright/test';

/**
 * Patch reservation settings and return the previous values so the
 * caller can restore them in `finally`. If the tenant doesn't have the
 * RESERVATION_SYSTEM feature on its plan we return `{ skip: true }` so
 * the test can decide to `test.skip(...)` cleanly instead of failing
 * inside `beforeAll`.
 */
export async function setReservationSettings(
  api: APIRequestContext,
  patch: Record<string, unknown>,
): Promise<{
  skip: boolean;
  reason?: string;
  previous: Record<string, unknown>;
}> {
  const cur = await api.get('reservations/settings/current');
  if (cur.status() === 403) {
    return {
      skip: true,
      reason: `RESERVATION_SYSTEM feature not enabled: ${await cur.text()}`,
      previous: {},
    };
  }
  if (!cur.ok()) {
    throw new Error(`get settings: ${cur.status()} ${await cur.text()}`);
  }
  const previous = await cur.json();

  const upd = await api.patch('reservations/settings/current', { data: patch });
  if (!upd.ok()) throw new Error(`patch settings: ${upd.status()} ${await upd.text()}`);

  // Keep only the keys we touched so restore is targeted.
  const restore: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) restore[k] = previous[k];
  return { skip: false, previous: restore };
}
