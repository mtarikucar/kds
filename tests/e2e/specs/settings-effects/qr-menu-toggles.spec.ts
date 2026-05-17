import { test, expect } from '../../fixtures/test';
import { request } from '@playwright/test';
import { loginAsApi } from '../../helpers/api';
import { setQrMenuSettings } from '../../helpers/factories';

const API_BASE = process.env.API_BASE || 'http://localhost:50080/api/';

test.describe('Settings → QR menu rendering options', () => {
  test('toggling showImages / showPrices / showDescription propagates to the public QR menu', async () => {
    const { api, user } = await loginAsApi('admin');
    await setQrMenuSettings(api, {
      showImages: false,
      showPrices: false,
      showDescription: false,
      primaryColor: '#FF0000',
      backgroundColor: '#000000',
    });

    const pub = await request.newContext({ baseURL: API_BASE });
    const res = await pub.get(`qr-menu/${user.tenantId}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    await pub.dispose();

    // Server passes the booleans straight through; the QR-menu UI reads
    // them and conditionally renders. Locking the values here keeps
    // downstream tests (visual regression in QR menu) honest.
    expect(body.settings.showImages).toBe(false);
    expect(body.settings.showPrices).toBe(false);
    expect(body.settings.showDescription).toBe(false);
    expect(body.settings.primaryColor).toBe('#FF0000');
    expect(body.settings.backgroundColor).toBe('#000000');
  });

  test('reset to defaults restores the standard colors', async () => {
    const { api, user } = await loginAsApi('admin');
    await setQrMenuSettings(api, {
      showImages: true,
      showPrices: true,
      showDescription: true,
      primaryColor: '#3B82F6',
      backgroundColor: '#FFFFFF',
    });

    const pub = await request.newContext({ baseURL: API_BASE });
    const res = await pub.get(`qr-menu/${user.tenantId}`);
    const body = await res.json();
    await pub.dispose();
    expect(body.settings.primaryColor).toBe('#3B82F6');
  });
});
