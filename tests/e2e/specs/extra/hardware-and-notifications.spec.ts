import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';

/**
 * Hardware device + tenant notification endpoints. Auth-gated but
 * available to any staff role; useful for the Tauri desktop app.
 */
test.describe('Hardware + tenant notifications', () => {
  test('GET /api/hardware/config responds for an authenticated user', async () => {
    const { api } = await loginAsApi('admin');
    const res = await api.get('hardware/config');
    // Either 200 with a config payload OR 404 if no devices configured
    // yet — never a 5xx or auth refusal.
    expect([200, 404]).toContain(res.status());
  });

  test('GET /notifications returns the user inbox', async () => {
    const { api } = await loginAsApi('admin');
    const res = await api.get('notifications');
    expect(res.ok()).toBeTruthy();
  });

  test('POST /notifications/mark-all-read clears unread state', async () => {
    const { api } = await loginAsApi('admin');
    const res = await api.post('notifications/mark-all-read');
    expect(res.ok()).toBeTruthy();
  });
});
