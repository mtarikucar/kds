import { WebhookOutboundService } from './webhook-outbound.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';
import {
  assertPublicHttpUrl as realAssertPublicHttpUrl,
  UnsafeUrlError,
} from '../../common/net/url-safety';

// Mock the SSRF helper so test URLs (example.com / .example) that may
// not DNS-resolve in CI still pass through. ftp:// is still rejected
// because the mock falls through to the real implementation's syntactic
// check — protocol validation happens before DNS lookup so we route
// `ftp://nope` to the real helper to preserve that assertion.
jest.mock('../../common/net/url-safety', () => {
  const actual = jest.requireActual('../../common/net/url-safety');
  return {
    ...actual,
    assertPublicHttpUrl: jest.fn(async (input: string) => {
      const u = new URL(input);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        throw new actual.UnsafeUrlError('URL must be http or https');
      }
      return { url: u, resolvedIp: '1.2.3.4' };
    }),
  };
});

// Silence "unused import" — real fn referenced for type only
void realAssertPublicHttpUrl;
void UnsafeUrlError;

/**
 * Subscribe / list / fanOut tests for WebhookOutboundService.
 *
 * The signing path is exercised in a separate spec; here we focus on the
 * lifecycle + fan-out routing rules:
 *   - subscribe rejects non-http URLs
 *   - secret is returned once (never derivable)
 *   - fanOut emits one delivery row per subscription whose `events` matches
 *   - wildcard `"*"` subscriptions catch everything
 *   - non-tenant events are skipped silently
 */
describe('WebhookOutboundService.subscribe + fanOut', () => {
  let prisma: MockPrismaClient;
  let bus: any;
  let svc: WebhookOutboundService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    bus = { on: jest.fn(), off: jest.fn(), onAny: jest.fn() };
    // Deterministic KMS that just round-trips the plaintext so the
    // subscribe path can store + the worker can retrieve secrets.
    const kms: any = {
      id: 'test',
      async encrypt({ plaintext }: any) {
        return Buffer.from(`enc:${plaintext}`);
      },
      async decrypt({ ciphertext }: any) {
        return ciphertext.toString().replace(/^enc:/, '');
      },
      async healthCheck() {
        return { ok: true };
      },
    };
    svc = new WebhookOutboundService(prisma as any, bus, kms);
  });

  it('subscribe refuses non-http(s) URLs', async () => {
    await expect(svc.subscribe('t1', { url: 'ftp://nope' })).rejects.toThrow(/http or https/);
  });

  it('subscribe enforces the per-tenant cap (iter-18)', async () => {
    // Cap default is 20. Simulate 20 active rows already present.
    (prisma.tenantWebhookSubscription.count as any).mockResolvedValue(20);

    await expect(
      svc.subscribe('t1', { url: 'https://r.example.com/hook' }),
    ).rejects.toThrow(/subscription cap reached/);

    // Crucially the create must NOT have been attempted — the cap is
    // checked before any KMS encrypt or DB write happens.
    expect((prisma.tenantWebhookSubscription.create as any).mock.calls.length).toBe(0);
  });

  it('subscribe counts active-only, so paused rows do not block creation (iter-18)', async () => {
    // The cap check passes a {status:'active'} filter — paused rows do
    // not consume cap budget. This test pins the contract.
    let countArgs: any = null;
    (prisma.tenantWebhookSubscription.count as any).mockImplementation(async (args: any) => {
      countArgs = args;
      return 0;
    });
    (prisma.tenantWebhookSubscription.create as any).mockResolvedValue({ id: 's-1' });

    await svc.subscribe('t1', { url: 'https://r.example.com/hook' });

    expect(countArgs).toEqual({ where: { tenantId: 't1', status: 'active' } });
  });

  it('subscribe returns the raw secret once + stores only the hash', async () => {
    let captured: any = null;
    (prisma.tenantWebhookSubscription.create as any).mockImplementation(async ({ data }: any) => {
      captured = data;
      return { id: 's-1', ...data };
    });
    const out = await svc.subscribe('t1', { url: 'https://r.example.com/hook' });
    expect(out.secret).toMatch(/^whs_[A-Za-z0-9_-]+$/);
    expect(captured.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(captured.secretHash).not.toBe(out.secret);
  });

  it('fanOut emits one delivery per matching subscription', async () => {
    (prisma.tenantWebhookSubscription.findMany as any).mockResolvedValue([
      { id: 's-1', tenantId: 't1', url: 'https://a.example/h', events: ['order.created.v1'], status: 'active' },
      { id: 's-2', tenantId: 't1', url: 'https://b.example/h', events: ['order.completed.v1'], status: 'active' },
    ]);
    const created: any[] = [];
    (prisma.webhookDelivery.create as any).mockImplementation(async ({ data }: any) => {
      created.push(data);
      return data;
    });

    await svc.fanOut({ id: 'evt-1', type: 'order.created.v1', tenantId: 't1', payload: {} });

    expect(created).toHaveLength(1);
    expect(created[0].subscriptionId).toBe('s-1');
    expect(created[0].eventType).toBe('order.created.v1');
  });

  it('wildcard "*" subscriptions catch everything', async () => {
    (prisma.tenantWebhookSubscription.findMany as any).mockResolvedValue([
      { id: 's-1', tenantId: 't1', url: 'https://a.example/h', events: ['*'], status: 'active' },
    ]);
    (prisma.webhookDelivery.create as any).mockResolvedValue({});

    await svc.fanOut({ id: 'evt-1', type: 'never.heard.of.it.v1', tenantId: 't1', payload: {} });
    expect((prisma.webhookDelivery.create as any).mock.calls.length).toBe(1);
  });

  it('fanOut silently skips events with no tenantId', async () => {
    await svc.fanOut({ id: 'evt-1', type: 'x', tenantId: null, payload: {} });
    expect((prisma.tenantWebhookSubscription.findMany as any).mock.calls.length).toBe(0);
  });

  // The iter-34 commit collapsed revoke()'s find-by-id + manual !==tenant
  // + delete-by-id pattern into a single tenant-scoped deleteMany. These
  // cases pin the new contract so a future refactor can't silently regress
  // it back to find-by-id and reintroduce the IDOR-adjacent surface.
  describe('revoke', () => {
    it('throws NotFoundException when the subscription belongs to a different tenant', async () => {
      // Compound deleteMany WHERE (id, tenantId) excludes the foreign row
      // at the DB layer, so the mock returns count=0.
      (prisma.tenantWebhookSubscription.deleteMany as any).mockResolvedValue({ count: 0 });
      await expect(svc.revoke('t1', 's-other')).rejects.toThrow(/Subscription not found/);
    });

    it('throws NotFoundException when the subscription does not exist', async () => {
      (prisma.tenantWebhookSubscription.deleteMany as any).mockResolvedValue({ count: 0 });
      await expect(svc.revoke('t1', 's-missing')).rejects.toThrow(/Subscription not found/);
    });

    it('issues a compound WHERE deleteMany on the happy path (no find-by-id read)', async () => {
      let captured: any = null;
      (prisma.tenantWebhookSubscription.deleteMany as any).mockImplementation(async ({ where }: any) => {
        captured = where;
        return { count: 1 };
      });

      await svc.revoke('t1', 's-1');

      // The tenant scope must be at the query layer, not in JS.
      expect(captured).toEqual({ id: 's-1', tenantId: 't1' });
      // Crucially, the service must NOT do a separate find-by-id read
      // before the delete — that was the IDOR-adjacent shape iter-34
      // eliminated. (If a future refactor reintroduces it, this assertion
      // breaks.)
      expect((prisma.tenantWebhookSubscription.findUnique as any).mock.calls.length).toBe(0);
      expect((prisma.tenantWebhookSubscription.findFirst as any).mock.calls.length).toBe(0);
    });
  });
});
