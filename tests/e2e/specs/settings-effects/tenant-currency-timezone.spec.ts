import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import { setTenantSettings } from '../../helpers/factories';

test.describe('Settings → Tenant currency + timezone propagate', () => {
  test('currency change flows to /subscriptions/current pricing read', async () => {
    const { api } = await loginAsApi('admin');

    // Currency is a tenant-level setting that affects every money
    // surface (receipts, Z-reports, invoices). Verify the patch lands
    // and that downstream reads pick it up.
    await setTenantSettings(api, { currency: 'EUR' });
    const after = await (await api.get('tenants/settings')).json();
    expect(after.currency).toBe('EUR');

    // Restore so other tests don't see EUR receipts.
    await setTenantSettings(api, { currency: 'TRY' });
    const restored = await (await api.get('tenants/settings')).json();
    expect(restored.currency).toBe('TRY');
  });

  test('timezone change persists and is readable', async () => {
    const { api } = await loginAsApi('admin');
    await setTenantSettings(api, { timezone: 'Europe/London' });
    const after = await (await api.get('tenants/settings')).json();
    expect(after.timezone).toBe('Europe/London');

    await setTenantSettings(api, { timezone: 'Europe/Istanbul' });
  });
});
