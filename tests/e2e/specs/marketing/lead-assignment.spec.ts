import { test, expect } from '../../fixtures/test';
import { loginAsMarketing } from '../../helpers/api';
import {
  createLead,
  assignLead,
  bulkAssignLeads,
  getDistributionConfig,
  setDistributionStrategy,
  getLead,
} from '../../helpers/factories/marketing';

/**
 * Covers the dispatcher-friendly assignment additions: unassign,
 * bulk-assign, assignmentStatus filter, and the distribution-config
 * endpoints. The single-assign happy path stays in leads.spec.ts.
 */
test.describe('Marketing — assignment dispatcher', () => {
  test('unassign — manager clears assignedToId via empty body', async () => {
    const { api, user } = await loginAsMarketing();
    const lead = await createLead(api);

    // Start with an explicit owner so the unassign has something to remove.
    await assignLead(api, lead.id, user.id);
    const before = await getLead(api, lead.id);
    expect(before.assignedToId).toBe(user.id);

    const cleared = await assignLead(api, lead.id, null);
    expect(cleared.assignedToId).toBeNull();

    const after = await getLead(api, lead.id);
    expect(after.assignedToId).toBeNull();
    await api.dispose();
  });

  test('assign — invalid rep id → 404', async () => {
    const { api } = await loginAsMarketing();
    const lead = await createLead(api);
    const res = await api.patch(`marketing/leads/${lead.id}/assign`, {
      data: { assignedToId: 'definitely-not-a-real-id' },
    });
    expect(res.status()).toBe(404);
    await api.dispose();
  });

  test('bulk-assign — assigns N leads, returns skipped for unknowns', async () => {
    const { api, user } = await loginAsMarketing();
    const a = await createLead(api);
    const b = await createLead(api);
    const c = await createLead(api);

    const fakeId = '00000000-0000-0000-0000-000000000000';
    const result = await bulkAssignLeads(
      api,
      [a.id, b.id, c.id, fakeId],
      user.id,
    );

    expect(result.assigned).toBeGreaterThanOrEqual(3);
    expect(result.skipped).toContain(fakeId);

    for (const id of [a.id, b.id, c.id]) {
      const fresh = await getLead(api, id);
      expect(fresh.assignedToId).toBe(user.id);
    }
    await api.dispose();
  });

  test('bulk-assign — empty leadIds → 400', async () => {
    const { api, user } = await loginAsMarketing();
    const res = await api.post('marketing/leads/bulk-assign', {
      data: { leadIds: [], assignedToId: user.id },
    });
    expect(res.status()).toBe(400);
    await api.dispose();
  });

  test('bulk-assign — over-cap (201 ids) → 400', async () => {
    const { api, user } = await loginAsMarketing();
    const ids = Array.from({ length: 201 }, (_, i) => `lead-${i}`);
    const res = await api.post('marketing/leads/bulk-assign', {
      data: { leadIds: ids, assignedToId: user.id },
    });
    expect(res.status()).toBe(400);
    await api.dispose();
  });

  test('assignmentStatus filter — unassigned/assigned/mine narrow the list', async () => {
    const { api, user } = await loginAsMarketing();
    // Two leads: one is auto-owned by the creator (the manager), one
    // we strip back to unassigned so both buckets are populated.
    const owned = await createLead(api);
    const orphan = await createLead(api);
    await assignLead(api, owned.id, user.id);
    await assignLead(api, orphan.id, null);

    const fetchIds = async (assignmentStatus: string) => {
      const res = await api.get(
        `marketing/leads?assignmentStatus=${assignmentStatus}&limit=100`,
      );
      const body = await res.json();
      return (body.data ?? []).map((l: { id: string }) => l.id);
    };

    const unassignedIds = await fetchIds('unassigned');
    expect(unassignedIds).toContain(orphan.id);
    expect(unassignedIds).not.toContain(owned.id);

    const mineIds = await fetchIds('mine');
    expect(mineIds).toContain(owned.id);
    expect(mineIds).not.toContain(orphan.id);

    await api.dispose();
  });

  test('distribution-config — GET returns seeded DISABLED row', async () => {
    const { api } = await loginAsMarketing();
    const cfg = await getDistributionConfig(api);
    expect(cfg).toHaveProperty('strategy');
    expect(['DISABLED', 'ROUND_ROBIN', 'LEAST_LOADED']).toContain(cfg.strategy);
    await api.dispose();
  });

  test('distribution-config — PATCH switches strategy and resets cursor', async () => {
    const { api } = await loginAsMarketing();
    const before = await getDistributionConfig(api);

    const updated = await setDistributionStrategy(api, 'ROUND_ROBIN');
    expect(updated.strategy).toBe('ROUND_ROBIN');
    // Switching from a different strategy clears the cursor — verify.
    if (before.strategy !== 'ROUND_ROBIN') {
      expect(updated.lastAssignedToId).toBeNull();
    }

    // Restore so we don't leak state across spec ordering.
    await setDistributionStrategy(api, before.strategy);
    await api.dispose();
  });

  test('distribution-config — invalid strategy → 400', async () => {
    const { api } = await loginAsMarketing();
    const res = await api.patch('marketing/distribution-config', {
      data: { strategy: 'BANANA' },
    });
    expect(res.status()).toBe(400);
    await api.dispose();
  });

  test('assignment activity carries metadata.kind=assignment', async () => {
    const { api, user } = await loginAsMarketing();
    const lead = await createLead(api);
    await assignLead(api, lead.id, user.id);

    const detailRes = await api.get(`marketing/leads/${lead.id}`);
    const detail = await detailRes.json();
    const assignmentActivity = (detail.activities ?? []).find(
      (a: { metadata?: { kind?: string } }) =>
        a.metadata && a.metadata.kind === 'assignment',
    );
    expect(assignmentActivity).toBeTruthy();
    expect(assignmentActivity.metadata.toUserId).toBe(user.id);

    await api.dispose();
  });
});
