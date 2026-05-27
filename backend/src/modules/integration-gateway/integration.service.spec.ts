import { IntegrationService } from './integration.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

// Fake adapter implementations for unit tests — small enough to inline,
// keeps tests independent of the real adapter shells. Each behaves as
// `parseWebhook(sig, raw)` happy-path returns []; tests that need a
// rejection path override the implementation per-test.
function fakeAdapter(id: string) {
  return {
    id,
    kind: 'delivery' as const,
    configSchema: {},
    init: jest.fn().mockResolvedValue(undefined),
    healthCheck: jest.fn().mockResolvedValue({ ok: true }),
    parseWebhook: jest.fn().mockResolvedValue([]),
  };
}

function buildSvc(prisma: MockPrismaClient, outbox: { append: jest.Mock }) {
  return new IntegrationService(
    prisma as any,
    outbox as any,
    fakeAdapter('yemeksepeti') as any,
    fakeAdapter('getir') as any,
    fakeAdapter('trendyol_yemek') as any,
  );
}

/**
 * The crypto helpers are the security-sensitive surface of this module —
 * a regression here would mean leaked tenant credentials. These tests pin
 * down per-tenant key derivation + AES-256-GCM round-trip.
 */
describe('IntegrationService crypto', () => {
  let prisma: MockPrismaClient;
  let outbox: { append: jest.Mock };
  let svc: IntegrationService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue('outbox') };
    svc = buildSvc(prisma, outbox);
    process.env.INTEGRATION_KEY = 'test-key-1234';
  });

  it('encrypts and decrypts a payload back to itself', () => {
    // encrypt + decrypt are private — `as any` is the established pattern
    // for unit-testing internal helpers without exporting them.
    const enc = (svc as any).encrypt('tenant-1', 'super-secret-token');
    const dec = (svc as any).decrypt('tenant-1', enc);
    expect(dec).toBe('super-secret-token');
  });

  it('uses a different ciphertext on every encryption (random IV)', () => {
    const a = (svc as any).encrypt('tenant-1', 'same');
    const b = (svc as any).encrypt('tenant-1', 'same');
    expect(Buffer.compare(a, b)).not.toBe(0);
  });

  it('refuses to decrypt with a different tenant key', () => {
    const enc = (svc as any).encrypt('tenant-1', 'super-secret-token');
    expect(() => (svc as any).decrypt('tenant-2', enc)).toThrow();
  });

  it('refuses to decrypt when ciphertext has been tampered with', () => {
    const enc = (svc as any).encrypt('tenant-1', 'super-secret-token');
    // Flip a byte deep in the ciphertext (after iv+tag).
    enc[40] = enc[40] ^ 0x01;
    expect(() => (svc as any).decrypt('tenant-1', enc)).toThrow();
  });
});

/**
 * Storage-DoS guards added in iter-16. The /v1/integrations/webhooks/*
 * route is PUBLIC — anyone can POST a payload — so the service must
 * reject (or silently drop) requests against unknown tenants, unknown
 * providers, or oversized bodies before writing a row to
 * IntegrationWebhookEvent. Without these guards a spammer hitting
 * random UUIDs against the public URL could fill disk on the JSONB
 * payload column.
 *
 * The "drop silently with 200" semantics are deliberate: a real
 * provider on a typo'd URL would otherwise retry forever, but we don't
 * want to enable enumeration of which tenants exist — so the success
 * envelope contains an `ignored: true` flag visible only to internal
 * callers (this test), and ops sees the actual reason via the logger.
 */
describe('IntegrationService.ingestWebhook (iter-16 storage-DoS guards)', () => {
  let prisma: MockPrismaClient;
  let outbox: { append: jest.Mock };
  let svc: IntegrationService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue('outbox') };
    svc = buildSvc(prisma, outbox);
    process.env.INTEGRATION_KEY = 'test-key-1234';
  });

  it('drops the webhook when tenantId is missing entirely', async () => {
    const out = await svc.ingestWebhook('yemeksepeti', null, {}, Buffer.from('{}'));

    expect(out).toEqual({ ignored: true, reason: 'missing tenant' });
    // No DB writes. The load-bearing assertion — a row created here is
    // the storage-flood hole this iter-16 fix closed.
    expect((prisma.integrationWebhookEvent.create as any).mock.calls.length).toBe(0);
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('drops the webhook when the tenant does not exist', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    prisma.integrationProviderDef.findUnique.mockResolvedValue({ id: 'yemeksepeti' } as any);

    const out = await svc.ingestWebhook('yemeksepeti', 'bogus-tenant', {}, Buffer.from('{}'));

    expect(out).toEqual({ ignored: true, reason: 'unknown tenant' });
    expect((prisma.integrationWebhookEvent.create as any).mock.calls.length).toBe(0);
  });

  it('drops the webhook when the provider does not exist', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1' } as any);
    prisma.integrationProviderDef.findUnique.mockResolvedValue(null);

    const out = await svc.ingestWebhook('bogus-provider', 't1', {}, Buffer.from('{}'));

    expect(out).toEqual({ ignored: true, reason: 'unknown provider' });
    expect((prisma.integrationWebhookEvent.create as any).mock.calls.length).toBe(0);
  });

  it('rejects oversized bodies before JSON.parse (CPU + storage DoS guard)', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1' } as any);
    prisma.integrationProviderDef.findUnique.mockResolvedValue({ id: 'yemeksepeti' } as any);
    // 64KB cap + 1 byte → over the limit.
    const oversized = Buffer.alloc(64 * 1024 + 1, 0x7b);

    const out = await svc.ingestWebhook('yemeksepeti', 't1', {}, oversized);

    expect(out).toEqual({ ignored: true, reason: 'payload too large' });
    // Crucially the body never gets JSON.parsed — pulling a 100MB
    // alleged-JSON apart only to drop the row would still be a CPU DoS.
    // We can't directly assert "JSON.parse was not called" without spying
    // on a global, but the create-call check covers the observable
    // outcome.
    expect((prisma.integrationWebhookEvent.create as any).mock.calls.length).toBe(0);
  });

  it('writes the row and appends to outbox on the happy path', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1' } as any);
    prisma.integrationProviderDef.findUnique.mockResolvedValue({ id: 'yemeksepeti' } as any);

    // The new HMAC-verification gate (iter-11) needs:
    //   1. a `connected` IntegrationConnection row with non-null
    //      credentialsEnc, decryptable with the test INTEGRATION_KEY.
    //   2. the adapter's parseWebhook to resolve (fake adapter does).
    const credsBlob = (svc as any).encrypt('t1', JSON.stringify({ secret: 's' }));
    prisma.integrationConnection.findFirst.mockResolvedValue({
      id: 'conn-1',
      tenantId: 't1',
      providerId: 'yemeksepeti',
      status: 'connected',
      credentialsEnc: credsBlob,
    } as any);

    let createArgs: any = null;
    (prisma.integrationWebhookEvent.create as any).mockImplementation(async ({ data }: any) => {
      createArgs = data;
      return { id: 'wh-1', ...data };
    });

    const out: any = await svc.ingestWebhook(
      'yemeksepeti',
      't1',
      { 'x-signature': 'sig-value' },
      Buffer.from('{"type":"order.created"}'),
    );

    // id is a server-side UUIDv7 (the `wh-1` in the mock gets overwritten
    // by the spread). The actual debugging hook is the createArgs shape.
    expect(out.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(createArgs.tenantId).toBe('t1');
    expect(createArgs.providerId).toBe('yemeksepeti');
    expect(createArgs.connectionId).toBe('conn-1');
    expect(createArgs.type).toBe('order.created');
    expect(createArgs.signature).toBe('sig-value');
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'integration.webhook.yemeksepeti.received.v1',
        tenantId: 't1',
      }),
    );
  });

  it('drops the webhook when no IntegrationConnection exists for the tenant', async () => {
    // Critical iter-11 invariant: URL-only tenant routing is not enough.
    // Without a connected row, an attacker could land arbitrary "verified"
    // payloads under any real tenant by guessing the URL — we refuse here.
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1' } as any);
    prisma.integrationProviderDef.findUnique.mockResolvedValue({ id: 'yemeksepeti' } as any);
    prisma.integrationConnection.findFirst.mockResolvedValue(null);

    const out = await svc.ingestWebhook(
      'yemeksepeti',
      't1',
      { 'x-signature': 'sig-value' },
      Buffer.from('{}'),
    );

    expect(out).toEqual({ ignored: true, reason: 'no connection' });
    expect((prisma.integrationWebhookEvent.create as any).mock.calls.length).toBe(0);
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('rejects a duplicate signature within the replay window (iter-17)', async () => {
    // HMAC verify proves the body+sig was signed by the provider's secret.
    // It does NOT prevent capture-and-replay. If a captured body+sig is
    // POSTed twice, the second one must short-circuit so we don't double-
    // process the same order/event downstream.
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1' } as any);
    prisma.integrationProviderDef.findUnique.mockResolvedValue({ id: 'yemeksepeti' } as any);
    const credsBlob = (svc as any).encrypt('t1', JSON.stringify({ secret: 's' }));
    prisma.integrationConnection.findFirst.mockResolvedValue({
      id: 'conn-1',
      tenantId: 't1',
      providerId: 'yemeksepeti',
      status: 'connected',
      credentialsEnc: credsBlob,
    } as any);
    prisma.integrationWebhookEvent.findFirst.mockResolvedValue({
      id: 'prev-event-id',
      receivedAt: new Date('2026-05-25T10:00:00Z'),
    } as any);

    const out = await svc.ingestWebhook(
      'yemeksepeti',
      't1',
      { 'x-signature': 'replayed-sig' },
      Buffer.from('{"type":"order.created"}'),
    );

    expect(out).toEqual({ ignored: true, reason: 'duplicate' });
    expect((prisma.integrationWebhookEvent.create as any).mock.calls.length).toBe(0);
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('drops the webhook when the adapter rejects the signature', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1' } as any);
    prisma.integrationProviderDef.findUnique.mockResolvedValue({ id: 'yemeksepeti' } as any);
    const credsBlob = (svc as any).encrypt('t1', JSON.stringify({ secret: 's' }));
    prisma.integrationConnection.findFirst.mockResolvedValue({
      id: 'conn-1',
      tenantId: 't1',
      providerId: 'yemeksepeti',
      status: 'connected',
      credentialsEnc: credsBlob,
    } as any);

    // Reach into the adapter and make parseWebhook reject.
    const adapter = (svc as any).adapters.get('yemeksepeti');
    adapter.parseWebhook.mockRejectedValueOnce(new Error('invalid signature'));

    const out = await svc.ingestWebhook(
      'yemeksepeti',
      't1',
      { 'x-signature': 'bad' },
      Buffer.from('{}'),
    );

    expect(out).toEqual({ ignored: true, reason: 'verify failed' });
    expect((prisma.integrationWebhookEvent.create as any).mock.calls.length).toBe(0);
    expect(outbox.append).not.toHaveBeenCalled();
  });
});
