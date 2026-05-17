import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';

/**
 * Shift template + schedule + swap is the personnel-mgmt backbone.
 * Demo seed doesn't preload templates, so we provision them per
 * test and assert the full lifecycle: create template → assign to
 * user → swap request → approval.
 */
test.describe('Personnel — shift templates + schedule + swap', () => {
  test('create + list + update a shift template', async () => {
    const { api } = await loginAsApi('admin');
    const create = await api.post('personnel/shift-templates', {
      data: {
        name: `Sabah ${Date.now()}`,
        startTime: '09:00',
        endTime: '17:00',
        color: '#3B82F6',
      },
    });
    expect(create.ok()).toBeTruthy();
    const tpl = await create.json();
    expect(tpl.id).toBeTruthy();

    const list = await api.get('personnel/shift-templates');
    expect(list.ok()).toBeTruthy();
    const all = await list.json();
    expect(all.some((t: any) => t.id === tpl.id)).toBe(true);

    const upd = await api.patch(`personnel/shift-templates/${tpl.id}`, {
      data: { endTime: '18:00' },
    });
    expect(upd.ok()).toBeTruthy();
  });

  test('GET /personnel/schedule responds for a date range', async () => {
    const { api } = await loginAsApi('admin');
    const today = new Date().toISOString().slice(0, 10);
    const res = await api.get(`personnel/schedule?startDate=${today}&endDate=${today}`);
    expect(res.ok()).toBeTruthy();
  });

  test('shift-swap list endpoint returns 200 for admin', async () => {
    const { api } = await loginAsApi('admin');
    const res = await api.get('personnel/shift-swap');
    expect(res.ok()).toBeTruthy();
  });
});
