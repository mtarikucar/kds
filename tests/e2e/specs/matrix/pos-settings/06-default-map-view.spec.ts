import { test, expect } from '../../../fixtures/test';
import { loginAsApi } from '../../../helpers/api';
import { setPosSettings } from '../../../helpers/factories';

/**
 * Setting: defaultMapView (PosSettings) — '2d' | '3d'
 *
 * Backend behavior verified:
 *   - The PATCH endpoint round-trips the string value. Only '2d' and
 *     '3d' are accepted by the frontend; the API stores whatever the
 *     client sends (front-end gates the choice via SettingsSelect).
 *
 * Frontend behavior verified:
 *   - The setting is exposed on the POS-settings payload and consumed
 *     by the admin floor-plan / tables view.
 *
 * CONTRACT GAP: at the time this spec was written, the admin tables
 * page (/admin/tables — TableManagementPage) does NOT yet render a
 * 2D/3D toggle. The setting is plumbed end-to-end on the API but the
 * UI consumer hasn't shipped. We pin the API round-trip and assert
 * the tables page loads; once the toggle ships, extend with a
 * `getByRole('button', { name: /2D|3D/ })` default-state check.
 */
test.describe('Setting: defaultMapView', () => {
  test('API: round-trips 2d', async () => {
    const { api } = await loginAsApi('admin');
    const got: any = await setPosSettings(api, { defaultMapView: '2d' });
    expect(got.defaultMapView).toBe('2d');
  });

  test('API: round-trips 3d', async () => {
    const { api } = await loginAsApi('admin');
    try {
      const got: any = await setPosSettings(api, { defaultMapView: '3d' });
      expect(got.defaultMapView).toBe('3d');
    } finally {
      // Restore default so downstream specs don't see a 3D tenant.
      await setPosSettings(api, { defaultMapView: '2d' });
    }
  });

  test('Browser: admin tables page loads while default map view is 2d', async ({
    adminPage,
  }) => {
    const { api } = await loginAsApi('admin');
    await setPosSettings(api, { defaultMapView: '2d' });

    await adminPage.goto('admin/tables');
    await adminPage.reload();
    await expect(adminPage.locator('h1, h2').first()).toBeVisible({ timeout: 15_000 });

    // CONTRACT GAP: the 2D/3D toggle UI is not yet wired into
    // TableManagementPage. Replace this no-op signal with a default-
    // state assertion (e.g. `data-view="2d"` or a Tab `aria-selected`)
    // once the toggle ships.
    expect(adminPage.url()).toContain('/admin/tables');
  });

  test('Browser: admin tables page loads while default map view is 3d', async ({
    adminPage,
  }) => {
    const { api } = await loginAsApi('admin');
    await setPosSettings(api, { defaultMapView: '3d' });

    try {
      await adminPage.goto('admin/tables');
      await adminPage.reload();
      await expect(adminPage.locator('h1, h2').first()).toBeVisible({ timeout: 15_000 });
      expect(adminPage.url()).toContain('/admin/tables');
    } finally {
      await setPosSettings(api, { defaultMapView: '2d' });
    }
  });
});
