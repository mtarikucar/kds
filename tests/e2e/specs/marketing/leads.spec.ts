import { test, expect } from '../../fixtures/test';
import { loginAsMarketing } from '../../helpers/api';
import {
  createLead,
  transitionLead,
  createTask,
  listLeadTasks,
  getLead,
  assignLead,
} from '../../helpers/factories/marketing';

test.describe('Marketing — lead lifecycle', () => {
  test('create — happy path', async () => {
    const { api } = await loginAsMarketing();
    const lead = await createLead(api);
    expect(lead.id).toBeTruthy();
    expect(lead.status).toBe('NEW');
    await api.dispose();
  });

  test('create — duplicate email → 409 (P2.1 regression)', async () => {
    const { api } = await loginAsMarketing();
    const email = `e2e-dup-${Date.now()}@example.com`;
    const first = await createLead(api, { email });
    expect(first.id).toBeTruthy();

    const dupRes = await api.post('marketing/leads', {
      data: {
        businessName: 'Dup Co',
        contactPerson: 'Dup Owner',
        email, // same!
        businessType: 'CAFE',
        source: 'REFERRAL',
      },
    });
    expect(dupRes.status()).toBe(409);
    const body = await dupRes.json();
    expect(String(body.message)).toMatch(/already exists/i);
    await api.dispose();
  });

  test('create — invalid phone regex → 400', async () => {
    const { api } = await loginAsMarketing();
    const res = await api.post('marketing/leads', {
      data: {
        businessName: 'Bad Phone Co',
        contactPerson: 'Owner',
        phone: 'not-a-phone',
        businessType: 'BAR',
        source: 'PHONE',
      },
    });
    expect(res.status()).toBe(400);
    await api.dispose();
  });

  test('status pipeline — NEW → CONTACTED → MEETING_DONE → DEMO_SCHEDULED → OFFER_SENT → WAITING', async () => {
    const { api } = await loginAsMarketing();
    const lead = await createLead(api);
    const path = ['CONTACTED', 'MEETING_DONE', 'DEMO_SCHEDULED', 'OFFER_SENT', 'WAITING'];
    for (const status of path) {
      const updated = await transitionLead(api, lead.id, status);
      expect(updated.status).toBe(status);
    }
    await api.dispose();
  });

  test('status — invalid transition NEW → DEMO_SCHEDULED → 400', async () => {
    const { api } = await loginAsMarketing();
    const lead = await createLead(api);
    const res = await api.patch(`marketing/leads/${lead.id}/status`, {
      data: { status: 'DEMO_SCHEDULED' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(String(body.message)).toMatch(/invalid transition/i);
    await api.dispose();
  });

  test('status — WON via /status is forbidden, must use /convert', async () => {
    const { api } = await loginAsMarketing();
    const lead = await createLead(api);
    await transitionLead(api, lead.id, 'CONTACTED');
    await transitionLead(api, lead.id, 'MEETING_DONE');
    await transitionLead(api, lead.id, 'OFFER_SENT');
    const res = await api.patch(`marketing/leads/${lead.id}/status`, {
      data: { status: 'WON' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(String(body.message)).toMatch(/convert/i);
    await api.dispose();
  });

  test('status — LOST cancels open tasks (P2.3 regression)', async () => {
    const { api } = await loginAsMarketing();
    const lead = await createLead(api);
    const pending = await createTask(api, { leadId: lead.id });
    const inProgress = await createTask(api, { leadId: lead.id });
    // Flip the second one to IN_PROGRESS so we cover both pre-cancel statuses.
    await api.patch(`marketing/tasks/${inProgress.id}`, { data: { status: 'IN_PROGRESS' } });
    const completed = await createTask(api, { leadId: lead.id });
    await api.patch(`marketing/tasks/${completed.id}/complete`);

    await transitionLead(api, lead.id, 'LOST', 'no_budget');

    const tasks = await listLeadTasks(api, lead.id);
    const byId = new Map<string, { status: string }>(
      (Array.isArray(tasks) ? tasks : tasks.data ?? []).map((t: any) => [t.id, t]),
    );
    expect(byId.get(pending.id)?.status).toBe('CANCELLED');
    expect(byId.get(inProgress.id)?.status).toBe('CANCELLED');
    expect(byId.get(completed.id)?.status).toBe('COMPLETED');
    await api.dispose();
  });

  test('terminal LOST cannot be re-opened', async () => {
    const { api } = await loginAsMarketing();
    const lead = await createLead(api);
    await transitionLead(api, lead.id, 'LOST', 'archived');
    const res = await api.patch(`marketing/leads/${lead.id}/status`, {
      data: { status: 'CONTACTED' },
    });
    expect(res.status()).toBe(400);
    await api.dispose();
  });

  test('assign — manager only; SALES_REP gets 403', async () => {
    const manager = await loginAsMarketing('SALES_MANAGER');
    const rep = await loginAsMarketing('SALES_REP');
    const lead = await createLead(manager.api);

    // Rep cannot assign — even themselves.
    const repRes = await rep.api.patch(`marketing/leads/${lead.id}/assign`, {
      data: { assignedToId: rep.user.id },
    });
    expect(repRes.status()).toBe(403);

    // Manager can.
    const assigned = await assignLead(manager.api, lead.id, rep.user.id);
    expect(assigned.assignedToId).toBe(rep.user.id);

    await manager.api.dispose();
    await rep.api.dispose();
  });

  test('delete — manager-only soft-archive to LOST', async () => {
    const manager = await loginAsMarketing('SALES_MANAGER');
    const rep = await loginAsMarketing('SALES_REP');
    const lead = await createLead(manager.api);

    const repRes = await rep.api.delete(`marketing/leads/${lead.id}`);
    expect(repRes.status()).toBe(403);

    const managerRes = await manager.api.delete(`marketing/leads/${lead.id}`);
    expect(managerRes.ok()).toBeTruthy();

    const fetched = await getLead(manager.api, lead.id);
    expect(fetched.status).toBe('LOST');

    await manager.api.dispose();
    await rep.api.dispose();
  });
});
