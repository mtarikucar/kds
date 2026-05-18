import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import { createTable, setTableStatus } from '../../helpers/factories/tables';
import { createPublicReservation, confirmReservation } from '../../helpers/factories/reservations';

function todayISO(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function fmt(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function inMinutes(min: number): Date {
  return new Date(Date.now() + min * 60_000);
}

test.describe('POS — reserved-table modal', () => {
  test('upcoming reservation → modal → seat → order screen', async ({ waiterPage }) => {
    const { api: adminApi, user: adminUser } = await loginAsApi('admin');

    const table = await createTable(adminApi);

    // 100 min from now: past demo's minAdvanceBooking=60, inside the
    // 2-hour `upcomingReservation` window the tables service annotates.
    const startTime = fmt(inMinutes(100));
    const endTime = fmt(inMinutes(190));
    const customerName = `E2E Reserve ${Date.now()}`;

    const reservation = await createPublicReservation(adminUser.tenantId, {
      date: todayISO(),
      startTime,
      endTime,
      guestCount: 2,
      customerName,
      tableId: table.id,
    });
    await confirmReservation(adminApi, reservation.id);

    // The auto-hold cron runs every 5 min; a test can't wait for it, so
    // flip the table status directly. Backend's upcomingReservation
    // annotation is independent of `reservationHoldId` — it just needs
    // a CONFIRMED reservation on this table within the next 2h.
    await setTableStatus(adminApi, table.id, 'RESERVED');

    await waiterPage.goto('pos');
    const grid = waiterPage.locator('[data-tour="table-grid"]');
    await expect(grid).toBeVisible({ timeout: 15_000 });

    // Tables grid renders one <button> per table; ours is the first
    // button whose visible label contains the newly-minted table number.
    const tableCard = grid.locator('button', { hasText: table.number }).first();
    await expect(tableCard).toBeVisible({ timeout: 10_000 });
    await tableCard.click();

    // Modal opens with reservation details. Scope text assertions to
    // the dialog so we don't accidentally match the same HH:mm rendered
    // by some other table card's badge. Regex covers en + tr locales
    // because the demo waiter's resolved language depends on browser
    // Accept-Language (Playwright defaults to en-US in CI, but local
    // dev may persist a Turkish preference in localStorage).
    const dialog = waiterPage.getByRole('dialog');
    await expect(
      dialog.getByText(/This table has a reservation|Bu masada rezervasyon var/i),
    ).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText(customerName)).toBeVisible();
    await expect(dialog.getByText(startTime)).toBeVisible();

    // Reservation status row must show the translated label, not the
    // raw enum. confirmReservation() above flips status → CONFIRMED.
    // Regression guard for the i18n key namespace (reservations:status,
    // singular — a prior fix had `statuses` plural which silently fell
    // through to the raw enum via defaultValue).
    // `getByText` is case-insensitive on string args, so use exact: true
    // to force case-sensitive matching for the negative assertion. The
    // translated label is "Confirmed" / "Onaylandı"; the raw enum would
    // be "CONFIRMED" — we must distinguish.
    await expect(dialog.getByText(/^Confirmed$|^Onaylandı$/)).toBeVisible();
    await expect(dialog.getByText('CONFIRMED', { exact: true })).toBeHidden();

    // Manual-lock toast must NOT also fire on the auto-hold path —
    // regression guard for the if/else in handleSelectTable.
    await expect(
      waiterPage.getByText(
        /This table was manually marked reserved by an admin|Bu masa yönetici tarafından manuel olarak rezerve edildi/i,
      ),
    ).toBeHidden();

    const seatBtn = dialog.getByRole('button', {
      name: /Guest arrived — Seat|Misafir geldi — Yerleştir/i,
    });
    await seatBtn.click();

    // After seat: dialog closes, order screen visible.
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(waiterPage.locator('[data-tour="menu-panel"]')).toBeVisible({ timeout: 10_000 });
    await expect(waiterPage.locator('[data-tour="order-cart"]')).toBeVisible();

    // Critical regression guard: a previous version of this flow flipped
    // the local selectedTable to OCCUPIED before the orders fetch had a
    // chance, which made the "occupied but no orders found" useEffect
    // warning fire on every seat. The skipPostSeatOrderEffectRef gate in
    // POSPage.tsx silences it; assert here so a future revert is caught.
    await expect(
      waiterPage.getByText(
        /Table is occupied but no active orders found|Masa dolu ancak aktif sipariş bulunamadı/i,
      ),
    ).toBeHidden();

    await adminApi.dispose();
  });

  test('manually-RESERVED table (no booking) shows toast, no modal', async ({ waiterPage }) => {
    const { api: adminApi } = await loginAsApi('admin');

    const table = await createTable(adminApi);
    await setTableStatus(adminApi, table.id, 'RESERVED');

    await waiterPage.goto('pos');
    const grid = waiterPage.locator('[data-tour="table-grid"]');
    await expect(grid).toBeVisible({ timeout: 15_000 });

    const tableCard = grid.locator('button', { hasText: table.number }).first();
    await tableCard.click();

    // Toast (sonner) appears with the manual-lock copy.
    await expect(
      waiterPage.getByText(
        /This table was manually marked reserved by an admin|Bu masa yönetici tarafından manuel olarak rezerve edildi/i,
      ),
    ).toBeVisible({ timeout: 5_000 });

    // Modal must NOT open — there's no reservation to seat.
    await expect(
      waiterPage.getByText(/This table has a reservation|Bu masada rezervasyon var/i),
    ).toBeHidden();

    await adminApi.dispose();
  });

  test('Escape mid-mutation is a no-op; dialog persists until seat resolves', async ({
    waiterPage,
  }) => {
    const { api: adminApi, user: adminUser } = await loginAsApi('admin');

    const table = await createTable(adminApi);
    const startTime = fmt(inMinutes(100));
    const endTime = fmt(inMinutes(190));
    const customerName = `E2E Reserve ${Date.now()}`;

    const reservation = await createPublicReservation(adminUser.tenantId, {
      date: todayISO(),
      startTime,
      endTime,
      guestCount: 2,
      customerName,
      tableId: table.id,
    });
    await confirmReservation(adminApi, reservation.id);
    await setTableStatus(adminApi, table.id, 'RESERVED');

    // Stretch the seat PATCH to ~1.2s so we have a clear window to
    // attempt an Escape close while the mutation is still pending. The
    // route handler proxies the real request via route.fetch() so the
    // backend state actually transitions — only the response delivery
    // to the page is delayed.
    await waiterPage.route('**/reservations/*/seat', async (route) => {
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.fulfill({ response });
    });

    await waiterPage.goto('pos');
    const grid = waiterPage.locator('[data-tour="table-grid"]');
    await expect(grid).toBeVisible({ timeout: 15_000 });
    await grid.locator('button', { hasText: table.number }).first().click();

    const dialog = waiterPage.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    const seatBtn = dialog.getByRole('button', {
      name: /Guest arrived — Seat|Misafir geldi — Yerleştir/i,
    });
    await seatBtn.click();

    // Wait for the mutation to enter the pending state before pressing
    // Escape — without this gate the keyboard event can race ahead of
    // the React click handler, the guard sees isPending=false, and the
    // dialog closes spuriously. Button swaps its label to the shared
    // common:app.loading copy while isLoading, so the seat-button name
    // disappears and the loading text appears in its place.
    await expect(dialog.getByText(/Loading\.\.\.|Yükleniyor\.\.\./)).toBeVisible({
      timeout: 5_000,
    });

    // Mid-mutation: Escape must be ignored by the guarded onClose. If
    // the guard were missing, the dialog would unmount here and the
    // waiter would be dropped on the table grid while the seat still
    // resolved server-side — a confusing UX bug.
    await waiterPage.keyboard.press('Escape');
    await expect(dialog).toBeVisible();

    // Once the mutation resolves, the success path closes the dialog
    // and routes us to the order screen normally.
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(waiterPage.locator('[data-tour="menu-panel"]')).toBeVisible({ timeout: 10_000 });

    await adminApi.dispose();
  });

  test('seat PATCH 409 → dialog stays open, error toast, retry works', async ({ waiterPage }) => {
    const { api: adminApi, user: adminUser } = await loginAsApi('admin');

    const table = await createTable(adminApi);
    const startTime = fmt(inMinutes(100));
    const endTime = fmt(inMinutes(190));
    const customerName = `E2E Reserve ${Date.now()}`;

    const reservation = await createPublicReservation(adminUser.tenantId, {
      date: todayISO(),
      startTime,
      endTime,
      guestCount: 2,
      customerName,
      tableId: table.id,
    });
    await confirmReservation(adminApi, reservation.id);
    await setTableStatus(adminApi, table.id, 'RESERVED');

    // Force a 409 on the first seat attempt — simulates "another
    // terminal seated this booking 50 ms ago" or "table state moved
    // out from under us". Unroute before the retry so the second
    // click hits the real backend.
    let interceptActive = true;
    await waiterPage.route('**/reservations/*/seat', async (route) => {
      if (interceptActive) {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            statusCode: 409,
            message: 'Reservation is no longer in a seatable state',
          }),
        });
      } else {
        await route.continue();
      }
    });

    await waiterPage.goto('pos');
    const grid = waiterPage.locator('[data-tour="table-grid"]');
    await expect(grid).toBeVisible({ timeout: 15_000 });
    await grid.locator('button', { hasText: table.number }).first().click();

    const dialog = waiterPage.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    const seatBtn = dialog.getByRole('button', {
      name: /Guest arrived — Seat|Misafir geldi — Yerleştir/i,
    });
    await seatBtn.click();

    // Error toast surfaces (sonner) and the dialog must remain open so
    // the waiter can retry or close at will. The onError handler in
    // useSeatReservation also invalidates ['tables'] and
    // ['reservations'] — verified indirectly by the retry succeeding
    // after we unroute.
    await expect(
      waiterPage.getByText(/Reservation is no longer in a seatable state/i),
    ).toBeVisible({ timeout: 5_000 });
    await expect(dialog).toBeVisible();
    await expect(seatBtn).toBeEnabled();

    interceptActive = false;
    await seatBtn.click();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(waiterPage.locator('[data-tour="menu-panel"]')).toBeVisible({ timeout: 10_000 });

    await adminApi.dispose();
  });
});
