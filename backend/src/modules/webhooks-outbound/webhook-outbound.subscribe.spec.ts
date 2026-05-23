import { WebhookOutboundService } from './webhook-outbound.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

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
    await expect(svc.subscribe('t1', { url: 'ftp://nope' })).rejects.toThrow(/http\(s\)/);
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
});
