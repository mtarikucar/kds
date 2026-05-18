import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import { createPublicReservation } from '../../helpers/factories/reservations';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmt(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function inMinutes(min: number): Date {
  return new Date(Date.now() + min * 60_000);
}

test.describe('Admin — reservations lifecycle action buttons', () => {
  test('PENDING reservation shows translated status badge (not raw enum)', async ({
    adminPage,
  }) => {
    const { user: admin, api: adminApi } = await loginAsApi('admin');

    // Create a PENDING reservation for today, tagged with a unique
    // customer name so we can locate the row deterministically. We
    // don't need it to land in the upcomingReservation window — the
    // admin page lists all reservations regardless.
    const customerName = `E2E Lifecycle ${Date.now()}`;
    await createPublicReservation(admin.tenantId, {
      date: todayISO(),
      startTime: fmt(inMinutes(120)),
      endTime: fmt(inMinutes(210)),
      guestCount: 2,
      customerName,
    });

    await adminPage.goto('admin/reservations');

    // Narrow the list to our reservation — the demo seed plus other
    // E2E runs leave dozens of rows, often spilling onto page 2 where
    // a `locator('tr', { hasText })` poll would never find ours.
    await adminPage
      .getByPlaceholder(/Search by name or phone|İsim veya telefon ile ara/i)
      .fill(customerName);

    const row = adminPage.locator('tr', { hasText: customerName });
    await expect(row).toBeVisible({ timeout: 10_000 });

    // The status badge must render the translated label. Regression
    // guard for the `reservations:status.*` namespace — see the dialog
    // sibling test for the same key. Raw enum would be "PENDING".
    await expect(row.getByText(/^Pending$|^Beklemede$/)).toBeVisible();
    await expect(row.getByText('PENDING', { exact: true })).toBeHidden();

    await adminApi.dispose();
  });

  test('confirm PATCH 409 → error toast, row state stays consistent after refetch', async ({
    adminPage,
  }) => {
    const { user: admin, api: adminApi } = await loginAsApi('admin');

    const customerName = `E2E Lifecycle ${Date.now()}`;
    await createPublicReservation(admin.tenantId, {
      date: todayISO(),
      startTime: fmt(inMinutes(120)),
      endTime: fmt(inMinutes(210)),
      guestCount: 2,
      customerName,
    });

    // Force the first confirm call to fail with 409 — simulates
    // "another terminal already confirmed/cancelled this row". The
    // onError handler in useConfirmReservation must invalidate
    // ['reservations'] so the refetch shows truth; without it, the
    // row would stay PENDING locally and the user would re-click and
    // re-error in a loop.
    let intercept = true;
    await adminPage.route('**/reservations/*/confirm', async (route) => {
      if (intercept) {
        intercept = false;
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            statusCode: 409,
            message: 'Reservation cannot be confirmed from its current state',
          }),
        });
      } else {
        await route.continue();
      }
    });

    await adminPage.goto('admin/reservations');
    await adminPage
      .getByPlaceholder(/Search by name or phone|İsim veya telefon ile ara/i)
      .fill(customerName);

    const row = adminPage.locator('tr', { hasText: customerName });
    await expect(row).toBeVisible({ timeout: 10_000 });

    // The confirm button is rendered with `title={t('reservations:actions.confirm')}`
    // (icon-only Lucide button). Locate it by accessible name within
    // the row so we don't accidentally click a different row's icon.
    const confirmBtn = row.getByRole('button', { name: /Confirm|Onayla/i });
    await confirmBtn.click();

    await expect(
      adminPage.getByText(/Reservation cannot be confirmed from its current state/i),
    ).toBeVisible({ timeout: 5_000 });

    // After the 409, the onError invalidator should have refetched
    // ['reservations']. The row remains PENDING locally (the real
    // state never changed), so the confirm button is still rendered
    // — proving the cache reflected truth rather than getting stuck.
    await expect(row.getByText(/^Pending$|^Beklemede$/)).toBeVisible();

    // Retry — intercept is now false so the real backend handles it.
    // `.first()` because sonner can briefly stack the error and
    // success toasts simultaneously, making the locator match twice.
    await confirmBtn.click();
    await expect(
      adminPage.getByText(/Reservation confirmed|Rezervasyon onaylandı/i).first(),
    ).toBeVisible({ timeout: 5_000 });
    await expect(row.getByText(/^Confirmed$|^Onaylandı$/)).toBeVisible({ timeout: 5_000 });

    await adminApi.dispose();
  });
});
