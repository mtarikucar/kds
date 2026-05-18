import { test, expect } from '../fixtures/test';
import { loginAsApi } from '../helpers/api';
import { createTable, setTableStatus } from '../helpers/factories/tables';

test.describe('Admin — Table management', () => {
  test('lists seeded tables and shows status counts', async ({ adminPage }) => {
    await adminPage.goto('admin/tables');
    await expect(adminPage).toHaveURL(/\/admin\/tables/);

    // Seed-demo creates 12 tables. We don't pin the exact number (other
    // tests may add more); we just verify the page loaded with content.
    await expect(adminPage.locator('body')).toContainText(/available|müsait|occupied|dolu/i);
  });

  test('can create a new table', async ({ adminPage }) => {
    await adminPage.goto('admin/tables');
    await adminPage.getByRole('button', { name: /add table|masa ekle/i }).first().click();

    // Modal opens — fill number and capacity.
    const uniqueNumber = `E2E${Date.now().toString().slice(-5)}`;
    await adminPage.getByLabel(/number|numara|table number|masa numarası/i).first().fill(uniqueNumber);
    await adminPage.getByLabel(/capacity|kapasite/i).first().fill('4');

    await adminPage
      .getByRole('button', { name: /^(create|save|kaydet|oluştur)$/i })
      .last()
      .click();

    await expect(adminPage.locator('body')).toContainText(uniqueNumber, { timeout: 10_000 });
  });

  // API-level CRUD coverage: the UI test above proves create works
  // end-to-end through the modal; these specs lock the rest of the
  // contract (update / status transitions / delete) without paying for
  // a browser navigation each. The factory helpers
  // (createTable / setTableStatus) already wrap the canonical routes.
  test('can update a table — capacity and section', async () => {
    const { api } = await loginAsApi('admin');
    try {
      const created = await createTable(api, { capacity: 4, section: 'inside' });
      const patched = await api.patch(`tables/${created.id}`, {
        data: { capacity: 6, section: 'patio' },
      });
      expect(patched.ok()).toBeTruthy();
      const after = await patched.json();
      expect(after.capacity).toBe(6);
      expect(after.section).toBe('patio');
    } finally {
      await api.dispose();
    }
  });

  test('status transitions — AVAILABLE → OCCUPIED → AVAILABLE', async () => {
    const { api } = await loginAsApi('admin');
    try {
      const t = await createTable(api, { status: 'AVAILABLE' });
      expect(t.status).toBe('AVAILABLE');

      await setTableStatus(api, t.id, 'OCCUPIED');
      const occ = await (await api.get(`tables/${t.id}`)).json();
      expect(occ.status).toBe('OCCUPIED');

      await setTableStatus(api, t.id, 'AVAILABLE');
      const ava = await (await api.get(`tables/${t.id}`)).json();
      expect(ava.status).toBe('AVAILABLE');
    } finally {
      await api.dispose();
    }
  });

  test('can delete an idle table; GET after returns 404', async () => {
    const { api } = await loginAsApi('admin');
    try {
      const t = await createTable(api);
      const del = await api.delete(`tables/${t.id}`);
      // The endpoint may respond 200 or 204 depending on whether the
      // server returns the deleted row — both are valid "deleted" states.
      expect([200, 204]).toContain(del.status());

      const fetched = await api.get(`tables/${t.id}`);
      // Soft-deletes may surface as 404 (gone from queries) — same
      // contract from the consumer's perspective.
      expect(fetched.status()).toBe(404);
    } finally {
      await api.dispose();
    }
  });
});
