import { test, expect } from '../../../fixtures/test';
import { loginAsApi } from '../../../helpers/api';
import { setTenantSettings } from '../../../helpers/factories';

/**
 * Tenant `timezone` is read by every server surface that needs to
 * answer the question "what does 'today' mean for this restaurant?":
 *
 *   - Reports (`/reports/sales`) bucket orders into [00:00, 24:00) in
 *     the tenant TZ via `getTenantMidnight()` — so the absolute UTC
 *     window returned for a default query shifts as TZ changes.
 *   - Z-report scheduling fires at the tenant's local midnight, again
 *     via the same helper.
 *   - The admin reports-settings page hydrates a <select> from this
 *     same column.
 *
 * We don't try to assert on the admin orders/reservations modals
 * because those render via the browser's `toLocaleString()` (which
 * uses the *client* TZ, not the tenant's). The signals we DO get:
 *
 *   1. API echo on `tenants/settings` after each patch.
 *   2. Admin reports-settings <select> reflects the saved value.
 *   3. Sales-report default range shifts hours when TZ changes — same
 *      "today" maps to a different UTC instant in Istanbul vs.
 *      New York vs. London.
 */

const TIMEZONES = ['Europe/Istanbul', 'Europe/London', 'America/New_York'] as const;

/**
 * Pull the absolute UTC window the reports endpoint computes for
 * "today" given the current tenant TZ. Returns the `startDate` /
 * `endDate` echoed by the response (sales summary includes them).
 */
async function reportWindowStart(
  api: import('@playwright/test').APIRequestContext,
): Promise<string> {
  const res = await api.get('reports/sales');
  // Some plan tiers gate ADVANCED_REPORTS; if the endpoint is
  // unavailable we can't assert on window shift, but we'll still get
  // the API-echo + UI signals from the other assertions.
  if (!res.ok()) return '';
  const json = await res.json();
  return typeof json.startDate === 'string' ? json.startDate : '';
}

test.describe('Settings → tenant timezone propagates to UI + reports', () => {
  test.afterAll(async () => {
    // Restore canonical demo TZ so downstream specs (Z-reports,
    // sales summaries) see the seed-default again.
    const { api } = await loginAsApi('admin');
    await setTenantSettings(api, { timezone: 'Europe/Istanbul' });
    await api.dispose();
  });

  for (const tz of TIMEZONES) {
    test(`timezone=${tz} → API echo + admin reports <select> reflect it`, async ({
      adminPage,
    }) => {
      const { api } = await loginAsApi('admin');
      await setTenantSettings(api, { timezone: tz });

      // API echo — fast contract that the column flipped.
      const echo = await (await api.get('tenants/settings')).json();
      expect(echo.timezone).toBe(tz);

      // Admin UI: the reports-settings page renders <SettingsSelect>
      // with `value={settings.timezone}` after hydrating from the
      // same `tenants/settings` row. The page contains exactly one
      // <select> (Timezone) under the SettingsGroup; the closingTime
      // and reportEmailEnabled controls are an <input type="time"> and
      // a <Switch>, not a <select>.
      await adminPage.goto('admin/settings/reports');
      const tzSelect = adminPage.locator('select').first();
      await expect(tzSelect).toBeVisible({ timeout: 15_000 });
      await expect(tzSelect).toHaveValue(tz);

      await api.dispose();
    });
  }

  test('timezone change shifts the default reports "today" window', async () => {
    // The reports endpoint computes [tenantMidnight, tenantMidnight+24h)
    // using the tenant's timezone. Without passing explicit start/end,
    // the same wall-clock moment maps to a *different* UTC instant
    // for "today's 00:00" in Istanbul vs. New York — the offset
    // between those zones is 7-8 hours, so the UTC startDate must
    // differ by at least 4 hours (much more than any clock skew or
    // round-off could explain).
    const { api } = await loginAsApi('admin');

    await setTenantSettings(api, { timezone: 'Europe/Istanbul' });
    const istanbulStart = await reportWindowStart(api);

    await setTenantSettings(api, { timezone: 'America/New_York' });
    const newYorkStart = await reportWindowStart(api);

    // If both came back empty the plan tier hides /reports/sales for
    // this tenant — skip the cross-TZ assertion in that case rather
    // than green-light a false positive.
    test.skip(
      !istanbulStart || !newYorkStart,
      'reports/sales unavailable on this plan; cross-TZ delta cannot be asserted',
    );

    const istanbulMs = Date.parse(istanbulStart);
    const newYorkMs = Date.parse(newYorkStart);
    expect(Number.isFinite(istanbulMs)).toBe(true);
    expect(Number.isFinite(newYorkMs)).toBe(true);

    const diffHours = Math.abs(istanbulMs - newYorkMs) / 3_600_000;
    // Real offset is 7-8h (DST-dependent); allow >= 4h to absorb any
    // sub-day drift while still proving the TZ flip moved the window.
    expect(diffHours).toBeGreaterThanOrEqual(4);

    await api.dispose();
  });
});
