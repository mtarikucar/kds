import { test, expect } from '../../../fixtures/test';
import { loginAsApi } from '../../../helpers/api';
import { setReservationSettings } from '../../../helpers/factories';

/**
 * Matrix: banner customization fields rendered on the public
 * reservation page (`/reserve/:tenantId`).
 *
 * `PublicReservationPage.tsx` reads from the public-settings endpoint
 * and renders:
 *   - settings.bannerTitle      → <h1>
 *   - settings.bannerDescription→ <p>
 *   - settings.customMessage    → blue info card
 *   - settings.bannerImageUrl   → backgroundImage on the banner div
 *
 * We set unique, easy-to-grep strings, navigate the page, and assert
 * each appears in the rendered DOM (or in inline style for the image URL).
 */
const FIXTURE = {
  bannerImageUrl: 'https://example.com/e2e-banner-fixture.jpg',
  bannerTitle: 'E2E Banner Title FIXTURE',
  bannerDescription: 'E2E Banner Description FIXTURE',
  customMessage: 'E2E Custom Message FIXTURE',
};

test.describe('Reservation settings — banner customization (browser)', () => {
  test('banner title, description, custom message and image URL render on the page', async ({
    page,
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    try {
      await setReservationSettings(api, { isEnabled: true, ...FIXTURE });

      await page.goto(`reserve/${demoTenantId}`);
      // Wait for any content to land — the page is gated on the
      // settings query resolving.
      await expect(page.locator('body')).toContainText(FIXTURE.bannerTitle, { timeout: 20_000 });
      await expect(page.locator('body')).toContainText(FIXTURE.bannerDescription);
      await expect(page.locator('body')).toContainText(FIXTURE.customMessage);

      // bannerImageUrl is set as a CSS background-image — assert the
      // banner div carries it in its inline style attribute.
      const bannerDiv = page.locator(`[style*="${FIXTURE.bannerImageUrl}"]`);
      await expect(bannerDiv).toHaveCount(1);
    } finally {
      // Wipe back to empty strings so other tests aren't surprised.
      await setReservationSettings(api, {
        bannerImageUrl: '',
        bannerTitle: '',
        bannerDescription: '',
        customMessage: '',
      });
      await api.dispose();
    }
  });
});
