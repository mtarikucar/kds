import { test, expect, request } from '@playwright/test';
import { loginAsMarketing, API_BASE } from '../../helpers/api';

/**
 * Token must match webServer.env.MARKETING_INGEST_TOKEN in
 * playwright.config.ts so the spec and the spawned backend agree.
 * Long enough (>=32 chars) to keep timing-safe compare meaningful;
 * the actual value doesn't matter for tests.
 */
const INGEST_TOKEN = 'e2e-ingest-token-do-not-rotate-pls-32+';

/**
 * Fresh externalRefs per run so reruns against a hot dev DB don't
 * collide with leftover rows from prior iterations.
 */
const runStamp = Date.now();
const ref = (i: number) => `hash:${runStamp.toString(16).padStart(40, '0').slice(-40)}${i}`.padEnd(45, '0').slice(-45);

const candidate = (i: number, overrides: Record<string, unknown> = {}) => ({
  externalRef: `hash:${(runStamp * 13 + i).toString(16).padStart(40, '0').slice(-40)}`,
  businessName: `E2E Ingest Cafe ${runStamp}-${i}`,
  city: 'Istanbul',
  businessType: 'CAFE',
  painPoint: 'kasada uzun bekleme şikayetleri',
  evidence: `https://maps.google.com/?q=e2e-${runStamp}-${i}`,
  pitch: 'KDS QR menü + masa siparişiyle bekleme süresini düşürür.',
  ...overrides,
});

async function ingestRequest() {
  return request.newContext({
    baseURL: API_BASE,
    extraHTTPHeaders: { 'content-type': 'application/json' },
  });
}

test.describe('Marketing — POST /marketing/leads/ingest', () => {
  test('rejects request with no X-Ingest-Token header', async () => {
    const ctx = await ingestRequest();
    const res = await ctx.post('marketing/leads/ingest', {
      data: { leads: [candidate(1)] },
    });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('rejects request with wrong X-Ingest-Token', async () => {
    const ctx = await request.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: { 'content-type': 'application/json', 'x-ingest-token': 'definitely-wrong' },
    });
    const res = await ctx.post('marketing/leads/ingest', {
      data: { leads: [candidate(2)] },
    });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('rejects body missing externalRef with 400', async () => {
    const ctx = await request.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: { 'content-type': 'application/json', 'x-ingest-token': INGEST_TOKEN },
    });
    const { externalRef: _omit, ...bad } = candidate(3);
    const res = await ctx.post('marketing/leads/ingest', {
      data: { leads: [bad] },
    });
    expect(res.status()).toBe(400);
    await ctx.dispose();
  });

  test('creates fresh candidates, dedups duplicates, and surfaces leads to marketing UI', async () => {
    const ctx = await request.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: { 'content-type': 'application/json', 'x-ingest-token': INGEST_TOKEN },
    });

    // 3 fresh candidates → created: 3
    const fresh = [candidate(10), candidate(11), candidate(12)];
    const created = await ctx.post('marketing/leads/ingest', { data: { leads: fresh } });
    expect(created.status()).toBe(200);
    const createdBody = await created.json();
    expect(createdBody).toEqual({ created: 3, skipped: 0, errors: [] });

    // Replay same payload → skipped: 3
    const replay = await ctx.post('marketing/leads/ingest', { data: { leads: fresh } });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual({ created: 0, skipped: 3, errors: [] });

    // Mix: 1 new + 2 existing → created: 1, skipped: 2
    const mixed = [candidate(20), fresh[0], fresh[1]];
    const mixRes = await ctx.post('marketing/leads/ingest', { data: { leads: mixed } });
    expect(mixRes.status()).toBe(200);
    expect(await mixRes.json()).toEqual({ created: 1, skipped: 2, errors: [] });

    await ctx.dispose();

    // Lead must appear under source=AI_RESEARCH for marketing users
    const { api } = await loginAsMarketing();
    const list = await api.get('marketing/leads?source=AI_RESEARCH&limit=50');
    expect(list.ok()).toBeTruthy();
    const listBody = await list.json();
    const items: Array<{ id: string; businessName: string; source: string }> = listBody.data ?? listBody.items ?? listBody;
    const names = items.map((l) => l.businessName);
    expect(names).toContain(fresh[0].businessName);
    expect(names).toContain(fresh[1].businessName);
    expect(names).toContain(fresh[2].businessName);

    // LeadActivity row must exist for at least one created lead
    const targetLead = items.find((l) => l.businessName === fresh[0].businessName);
    expect(targetLead).toBeTruthy();
    const acts = await api.get(`marketing/leads/${targetLead!.id}/activities`);
    expect(acts.ok()).toBeTruthy();
    const actsBody = await acts.json();
    const actsList: Array<{ type: string; title: string }> = Array.isArray(actsBody) ? actsBody : actsBody.data ?? actsBody.items ?? [];
    const provenance = actsList.find((a) => a.title === 'Created by AI research routine');
    expect(provenance, 'expected an activity attributing the lead to the AI research routine').toBeTruthy();
    expect(provenance!.type).toBe('NOTE');

    await api.dispose();
  });

  test('rate-limits at the long-tier ceiling (>6 calls/60s)', async () => {
    const ctx = await request.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: { 'content-type': 'application/json', 'x-ingest-token': INGEST_TOKEN },
    });

    // Use an empty-batch-shape that's also valid: 1-item payload with unique externalRef per call.
    let last = 200;
    for (let i = 0; i < 8; i++) {
      const r = await ctx.post('marketing/leads/ingest', { data: { leads: [candidate(100 + i)] } });
      last = r.status();
      if (last === 429) break;
    }
    expect(last).toBe(429);
    await ctx.dispose();
  });
});
