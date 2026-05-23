import { WebhookDeliveryWorkerService } from './webhook-delivery-worker.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

/**
 * The worker is the part that actually POSTs to tenant URLs. These tests
 * stub `global.fetch` so the success / failure / auto-pause branches are
 * exercised in isolation.
 */
describe('WebhookDeliveryWorkerService.tick', () => {
  let prisma: MockPrismaClient;
  let svc: WebhookDeliveryWorkerService;
  let originalFetch: any;

  beforeEach(() => {
    prisma = mockPrismaClient();
    // The worker now depends on WebhookOutboundService for secret unsealing.
    // Mock returns a fixed raw secret so the HMAC signing path stays
    // deterministic without dragging KMS plumbing into this spec.
    const outbound: any = {
      async unsealSecret(_sub: any) {
        return 'test-raw-secret';
      },
    };
    svc = new WebhookDeliveryWorkerService(prisma as any, outbound);
    originalFetch = (global as any).fetch;
  });

  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  function pendingDelivery(over: Partial<any> = {}) {
    return {
      id: 'd-1',
      subscriptionId: 's-1',
      eventType: 'order.created.v1',
      eventId: 'evt-1',
      url: 'https://tenant.example.com/hook',
      status: 'pending',
      attempts: 0,
      ...over,
      subscription: {
        id: 's-1',
        tenantId: 't1',
        secretHash: 'whs_test_hash',
        status: 'active',
        consecutiveFailures: 0,
        ...(over as any).subscription,
      },
    };
  }

  it('on 2xx response marks the delivery delivered + clears consecutive failures', async () => {
    (prisma.webhookDelivery.findMany as any).mockResolvedValue([pendingDelivery()]);
    (prisma.outboxEvent.findUnique as any).mockResolvedValue({ payload: { foo: 'bar' } });
    let updatedDelivery: any = null;
    let updatedSub: any = null;
    (prisma.webhookDelivery.update as any).mockImplementation(async ({ data }: any) => {
      updatedDelivery = data;
      return { id: 'd-1' };
    });
    (prisma.tenantWebhookSubscription.update as any).mockImplementation(async ({ data }: any) => {
      updatedSub = data;
      return { id: 's-1' };
    });
    (global as any).fetch = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => 'ok',
    });

    await svc.tickOnce();

    expect((global as any).fetch).toHaveBeenCalledTimes(1);
    expect(updatedDelivery.status).toBe('delivered');
    expect(updatedDelivery.lastStatusCode).toBe(200);
    expect(updatedSub.consecutiveFailures).toBe(0);
  });

  it('on 5xx response keeps pending + schedules backoff', async () => {
    (prisma.webhookDelivery.findMany as any).mockResolvedValue([pendingDelivery()]);
    (prisma.outboxEvent.findUnique as any).mockResolvedValue({ payload: {} });
    let updatedDelivery: any = null;
    let updatedSub: any = null;
    (prisma.webhookDelivery.update as any).mockImplementation(async ({ data }: any) => {
      updatedDelivery = data;
      return { id: 'd-1' };
    });
    (prisma.tenantWebhookSubscription.update as any).mockImplementation(async ({ data }: any) => {
      updatedSub = data;
      return { id: 's-1' };
    });
    (prisma.tenantWebhookSubscription.findUnique as any).mockResolvedValue({ consecutiveFailures: 1 });
    (global as any).fetch = jest.fn().mockResolvedValue({
      status: 503,
      ok: false,
      text: async () => 'busy',
    });

    await svc.tickOnce();

    expect(updatedDelivery.status).toBe('pending');
    expect(updatedDelivery.lastStatusCode).toBe(503);
    expect(updatedDelivery.nextAttemptAt).toBeInstanceOf(Date);
    expect(updatedSub.consecutiveFailures.increment).toBe(1);
  });

  it('auto-pauses the subscription after 20 consecutive failures', async () => {
    (prisma.webhookDelivery.findMany as any).mockResolvedValue([pendingDelivery()]);
    (prisma.outboxEvent.findUnique as any).mockResolvedValue({ payload: {} });
    (prisma.webhookDelivery.update as any).mockResolvedValue({ id: 'd-1' });
    // The increment-then-select-back UPDATE returns the post-increment
    // value. We pin it at 20 (== AUTO_PAUSE_AFTER) so the worker flips
    // the subscription to 'paused' via the updateMany guard.
    (prisma.tenantWebhookSubscription.update as any).mockResolvedValue({
      id: 's-1',
      consecutiveFailures: 20,
    });
    (prisma.tenantWebhookSubscription.updateMany as any).mockResolvedValue({ count: 1 });
    (global as any).fetch = jest.fn().mockResolvedValue({
      status: 500, ok: false, text: async () => '',
    });

    await svc.tickOnce();

    const pauseCalls = (prisma.tenantWebhookSubscription.updateMany as any).mock.calls;
    const pauseCall = pauseCalls.find((c: any) => c[0].data.status === 'paused');
    expect(pauseCall).toBeDefined();
  });

  it('skips deliveries whose subscription is no longer active', async () => {
    (prisma.webhookDelivery.findMany as any).mockResolvedValue([
      pendingDelivery({ subscription: { status: 'paused', tenantId: 't1', secretHash: 'h' } }),
    ]);
    const fetchSpy = jest.fn();
    (global as any).fetch = fetchSpy;

    await svc.tickOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('treats a fetch throw (network error) as a retryable failure', async () => {
    (prisma.webhookDelivery.findMany as any).mockResolvedValue([pendingDelivery()]);
    (prisma.outboxEvent.findUnique as any).mockResolvedValue({ payload: {} });
    let updated: any = null;
    (prisma.webhookDelivery.update as any).mockImplementation(async ({ data }: any) => {
      updated = data;
      return { id: 'd-1' };
    });
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET'));

    await svc.tickOnce();

    expect(updated.status).toBe('pending');
    expect(updated.lastStatusCode).toBe(0);
    expect(updated.lastResponseSnippet).toMatch(/ECONNRESET/);
  });
});
