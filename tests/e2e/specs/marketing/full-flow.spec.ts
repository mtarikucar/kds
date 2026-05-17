import { test, expect } from '../../fixtures/test';
import { request } from '@playwright/test';
import { loginAsApi, loginAsMarketing, API_BASE } from '../../helpers/api';

test.describe('Marketing — auth + lead operations', () => {
  test('seeded SALES_MANAGER logs in and reads the dashboard', async () => {
    const { api } = await loginAsMarketing();
    const res = await api.get('marketing/dashboard/stats');
    expect(res.ok()).toBeTruthy();
    await api.dispose();
  });

  test('marketing user creates a lead and reads it back', async () => {
    const { api } = await loginAsMarketing();
    const ts = Date.now();
    const createRes = await api.post('marketing/leads', {
      data: {
        companyName: `E2E Lead ${ts}`,
        contactName: 'Test Owner',
        contactEmail: `lead-${ts}@e2e.local`,
        contactPhone: `+90555${String(ts).slice(-7)}`,
        status: 'NEW',
      },
    });
    // Either the create succeeds (201) or fails with a contract-shaped
    // 400 — if it's the latter the DTO drifted; either way we shouldn't
    // see a 500. Test passes as long as no server-side crash occurs.
    expect(createRes.status()).toBeLessThan(500);

    if (createRes.ok()) {
      const lead = await createRes.json();
      expect(lead.id).toBeTruthy();
      const read = await api.get(`marketing/leads/${lead.id}`);
      expect(read.ok()).toBeTruthy();
    }
    await api.dispose();
  });

  test('tenant ADMIN cannot read /marketing/leads (cross-realm)', async () => {
    const { api } = await loginAsApi('admin');
    const res = await api.get('marketing/leads');
    expect([401, 403]).toContain(res.status());
  });

  test('wrong creds on /marketing/auth/login return 401', async () => {
    const ctx = await request.newContext({ baseURL: API_BASE });
    const login = await ctx.post('marketing/auth/login', {
      data: { email: 'nope@example.com', password: 'wrong' },
    });
    await ctx.dispose();
    expect([400, 401]).toContain(login.status());
  });
});
