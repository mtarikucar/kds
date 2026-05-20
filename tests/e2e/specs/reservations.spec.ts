import type { Page } from '@playwright/test';
import { request } from '@playwright/test';
import { test, expect } from '../fixtures/test';

function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Drive the public reservation wizard up through step 4 (contact),
 * leaving the caller to fill contact + submit. Used by the email-only
 * and phone-only flows so they share the date/time/table dance.
 */
async function advanceToContactStep(page: Page, tenantId: string) {
  await page.goto(`reserve/${tenantId}`);

  // Step 1: date + guests. The wizard defaults to 2 guests; we
  // don't need to click the pill explicitly. (Skipping it also
  // sidesteps the collision with the stepper button '2'.)
  await page.locator('input[type="date"]').fill(tomorrowISO());
  await page.getByRole('button', { name: /Next|İleri/i }).click();

  // Step 2: pick a PM slot. Past/full/closed slots are filtered out
  // entirely; we pick a PM slot specifically to avoid 12:00 AM
  // (midnight) edge cases in the per-customer duplicate-reservation
  // guard, which buckets by email+date+time.
  await page.waitForTimeout(500);
  const pmSlot = page.getByRole('button', { name: /\d{1,2}:\d{2}\s?PM/i }).first();
  await pmSlot.click();
  await page.getByRole('button', { name: /Next|İleri/i }).click();

  // Step 3: any table is fine (preselected). Advance.
  await page.getByRole('button', { name: /Next|İleri/i }).click();
}

test.describe('Reservations — public booking + admin view', () => {
  test('public reservation page loads for demo tenant', async ({ page, demoTenantId }) => {
    await page.goto(`reserve/${demoTenantId}`);
    await expect(page).toHaveURL(new RegExp(`/reserve/${demoTenantId}`));
    await expect(page.locator('body')).toContainText(/reservation|rezervasyon/i, {
      timeout: 15_000,
    });
  });

  test('reservation lookup page is reachable and uses the redesigned shell', async ({
    page,
    demoTenantId,
  }) => {
    await page.goto(`reserve/${demoTenantId}/lookup`);
    await expect(page).toHaveURL(/lookup/);
    await expect(page.locator('body')).not.toContainText('Invalid Date');
  });

  test('admin reservations page renders', async ({ adminPage }) => {
    await adminPage.goto('admin/reservations');
    await expect(adminPage).toHaveURL(/\/admin\/reservations/);
  });

  test('backend rejects past-time bookings (defense regardless of minAdvanceBooking)', async ({
    demoTenantId,
  }) => {
    // Hit the public-create endpoint directly with a time strictly in
    // the past on today's date. Regression guard for the bug where
    // `if (settings.minAdvanceBooking)` short-circuited the past-time
    // check for any tenant whose setting was 0 / undefined.
    const ctx = await request.newContext({ baseURL: 'http://localhost:50080/api/' });
    const todayISO = new Date().toISOString().slice(0, 10);
    // Pick a deterministically-past time: 00:01 — always in the past
    // by the time tests run (the demo opens at 00:00 but past-time
    // check uses `< now`, so 00:01 today < now late-afternoon test).
    const res = await ctx.post(`public/reservations/${demoTenantId}`, {
      data: {
        date: todayISO,
        startTime: '00:01',
        endTime: '01:01',
        guestCount: 2,
        customerName: 'E2E past-time probe',
        customerEmail: `past-${Date.now()}@example.com`,
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/past|too soon/i);
    await ctx.dispose();
  });

  test('past time slots are hidden, not greyed', async ({ page, demoTenantId }) => {
    await page.goto(`reserve/${demoTenantId}`);
    await page.locator('input[type="date"]').fill(tomorrowISO());
    await page.getByRole('button', { name: /Next|İleri/i }).click();

    // Step 2 — past slots are filtered out entirely. We assert that
    // no time-pattern button on the page is rendered as disabled (the
    // old behavior was `<button disabled> 8:00 AM </button>`).
    await page.waitForTimeout(500);
    const slotButtons = page.getByRole('button').filter({ hasText: /^\d{1,2}:\d{2}\s?(AM|PM)$/ });
    const count = await slotButtons.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(slotButtons.nth(i)).toBeEnabled();
    }
  });

  test('email-or-phone validation blocks the contact step when both empty', async ({
    page,
    demoTenantId,
  }) => {
    await advanceToContactStep(page, demoTenantId);

    await page.locator('input[autocomplete="name"]').fill('E2E Tester');
    await page.getByRole('button', { name: /Next|İleri/i }).click();

    await expect(
      page.getByText(/Either email or phone is required|E-posta veya telefondan biri zorunlu/i),
    ).toBeVisible({ timeout: 5_000 });

    await page.locator('input[type="email"]').fill('e2e@example.com');
    await page.getByRole('button', { name: /Next|İleri/i }).click();
    await expect(
      page.getByText(/Review your reservation|Rezervasyonunu gözden geçir/i),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('email-only booking → confirmation card with "call to cancel" hint', async ({
    page,
    demoTenantId,
  }) => {
    await advanceToContactStep(page, demoTenantId);

    // Unique email per test run to dodge the per-customer
    // duplicate-reservation guard (same email + date + time = 400).
    const uniq = Date.now();
    await page.locator('input[autocomplete="name"]').fill(`E2E Email Only ${uniq}`);
    await page.locator('input[type="email"]').fill(`e2e-email-only-${uniq}@example.com`);
    await page.getByRole('button', { name: /Next|İleri/i }).click();

    // Wait for step 5 to render before querying the submit button —
    // the wizard re-mounts the action button (Next → Book Now) when
    // step advances, and racing the query against that re-mount
    // makes Playwright land on a brief disabled-during-pending state.
    await expect(
      page.getByText(/Review your reservation|Rezervasyonunu gözden geçir/i),
    ).toBeVisible({ timeout: 5_000 });

    // Submit. Use the button by its visible label rather than
    // `[type="submit"]` so we don't accidentally match a button that's
    // disabled (the same submit button briefly disables while the
    // mutation is in flight, and detaches from DOM right after).
    const postPromise = page.waitForResponse(
      (r) => r.url().includes(`/public/reservations/${demoTenantId}`) && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /^Book Now$|^Rezervasyonu Tamamla$|^Onayla$/i }).click();
    const postResponse = await postPromise;
    expect(postResponse.status()).toBe(201);

    await expect(page.getByText(/R-\d{8}-\d+/i)).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(/call the restaurant|restoranı arayın|اتصل بالمطعم/i),
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Invalid Date');
  });

  test('phone-only booking → lookup-by-phone retrieves the reservation', async ({
    page,
    demoTenantId,
  }) => {
    await advanceToContactStep(page, demoTenantId);

    const phone = `+9055${Date.now().toString().slice(-9)}`;
    const customerName = `E2E Phone Only ${Date.now()}`;
    await page.locator('input[autocomplete="name"]').fill(customerName);
    await page.locator('input[type="tel"]').fill(phone);
    await page.getByRole('button', { name: /Next|İleri/i }).click();

    await expect(
      page.getByText(/Review your reservation|Rezervasyonunu gözden geçir/i),
    ).toBeVisible({ timeout: 5_000 });

    const postPromise = page.waitForResponse(
      (r) => r.url().includes(`/public/reservations/${demoTenantId}`) && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /^Book Now$|^Rezervasyonu Tamamla$|^Onayla$/i }).click();
    const postResponse = await postPromise;
    expect(postResponse.status()).toBe(201);

    const numberLocator = page.getByText(/R-\d{8}-\d+/i).first();
    await expect(numberLocator).toBeVisible({ timeout: 10_000 });
    const reservationNumber = (await numberLocator.textContent())?.trim() ?? '';

    await page.goto(`reserve/${demoTenantId}/lookup`);
    await page.locator('input[type="tel"]').fill(phone);
    // The reservation-number input is the only `input[type="text"]`
    // on the lookup form (phone is type=tel).
    await page.locator('input[type="text"]').fill(reservationNumber);
    await page.locator('form button[type="submit"]').click();

    await expect(page.getByText(reservationNumber)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('body')).not.toContainText('Invalid Date');
  });
});
