import { test, expect } from '../../fixtures/test';
import { request, APIRequestContext } from '@playwright/test';
import { loginAsApi, loginAsSuperAdmin, API_BASE } from '../../helpers/api';

/**
 * SuperAdmin login burns a TOTP step that the backend then refuses
 * to accept again until the step expires (TOTP_REPLAY_TTL_MS). Two
 * `loginAsSuperAdmin()` calls inside the same 30-second window
 * therefore can't both succeed — we cache the session per file.
 */
let superApi: APIRequestContext;

test.beforeAll(async () => {
  // `loginAsSuperAdmin` is module-level cached — do not dispose here.
  // The cache is shared across all spec files in the same Playwright
  // worker so the backend's TOTP_REPLAY window doesn't bite us.
  ({ api: superApi } = await loginAsSuperAdmin());
});

test.describe('SuperAdmin — auth + tenant operations', () => {
  test('seeded superadmin can list tenants', async () => {
    const res = await superApi.get('superadmin/tenants');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const items = Array.isArray(body) ? body : body.data ?? body.items ?? [];
    expect(items.length).toBeGreaterThan(0);
  });

  test('superadmin can flip a tenant feature override and reset it', async () => {
    const { user: tenantAdmin } = await loginAsApi('admin');

    // Force advancedReports OFF via override; the tenant's effective
    // features should reflect that, overriding the BUSINESS-plan
    // default of `true`.
    const flipOff = await superApi.patch(`superadmin/tenants/${tenantAdmin.tenantId}/overrides`, {
      data: { featureOverrides: { advancedReports: false } },
    });
    expect(flipOff.ok()).toBeTruthy();

    const { api: tenantApi } = await loginAsApi('admin');
    const eff = await (await tenantApi.get('subscriptions/effective-features')).json();
    expect(eff.features.advancedReports).toBe(false);

    // Reset and re-read — overrides cleared, plan default restored.
    const reset = await superApi.patch(`superadmin/tenants/${tenantAdmin.tenantId}/overrides`, {
      data: { featureOverrides: {} },
    });
    expect(reset.ok()).toBeTruthy();
    const eff2 = await (await tenantApi.get('subscriptions/effective-features')).json();
    expect(eff2.features.advancedReports).toBe(true);
  });

  test('tenant ADMIN cannot impersonate superadmin', async () => {
    const { api, user } = await loginAsApi('admin');
    const a = await api.get('superadmin/tenants');
    expect([401, 403]).toContain(a.status());

    const b = await api.patch(`superadmin/tenants/${user.tenantId}/overrides`, {
      data: { featureOverrides: { advancedReports: true } },
    });
    expect([401, 403]).toContain(b.status());
  });

  test('wrong creds on /superadmin/auth/login return 401', async () => {
    const ctx = await request.newContext({ baseURL: API_BASE });
    const login = await ctx.post('superadmin/auth/login', {
      data: { email: 'nope@example.com', password: 'definitely-wrong' },
    });
    await ctx.dispose();
    expect([400, 401]).toContain(login.status());
  });
});
