import { createHmac } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { CallerController } from './caller.controller';
import { CallerProviderRegistry } from './caller-provider.registry';

/**
 * Iter-55 / v2.8.93 regression for the prod refusal on the mock caller webhook.
 *
 * Before iter-55, /v1/caller/webhooks/mock/:tenantId was completely
 * unauthenticated — the mock adapter ignores the x-signature header,
 * and there's no IP allowlist or HMAC layer above. Anyone on the
 * public internet could spam fake calls into any tenant's feed by
 * guessing tenant UUIDs.
 *
 * Iter-55 fixed this with a hard refusal in production behind an
 * ALLOW_MOCK_CALLER_IN_PROD=true escape hatch. v2.8.93 removed the
 * escape hatch — an accidentally-flipped env var must not be the
 * difference between "mock disabled" and "anyone can spoof any
 * caller". The refusal is now unconditional in prod.
 */
describe('CallerController.webhook prod refusal (iter-55 + v2.8.93)', () => {
  const baseEnv = { ...process.env };
  let caller: { ingest: jest.Mock; listRecent: jest.Mock };
  let mockProvider: { parseWebhook: jest.Mock };
  let registry: CallerProviderRegistry;
  let ctrl: CallerController;
  const TWILIO_SECRET = 'whsec_twilio';

  beforeEach(() => {
    caller = { ingest: jest.fn().mockResolvedValue(undefined), listRecent: jest.fn() };
    mockProvider = { parseWebhook: jest.fn().mockResolvedValue([]) };
    registry = new CallerProviderRegistry({
      get: (k: string) =>
        k === 'CALLER_WEBHOOK_SECRET__TWILIO' ? TWILIO_SECRET : undefined,
    } as any);
    ctrl = new CallerController(caller as any, mockProvider as any, registry);
  });

  afterEach(() => {
    process.env = { ...baseEnv };
  });

  function reqWith(body: any) {
    return { rawBody: Buffer.from(JSON.stringify(body)), body } as any;
  }

  function nowSec() {
    return String(Math.floor(Date.now() / 1000));
  }

  it('throws ForbiddenException in production (unconditional)', async () => {
    process.env.NODE_ENV = 'production';

    await expect(
      ctrl.webhook('mock', 't1', 'sig', nowSec(), reqWith({ e164: '+1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(mockProvider.parseWebhook).not.toHaveBeenCalled();
    expect(caller.ingest).not.toHaveBeenCalled();
  });

  it('still refuses in production even if ALLOW_MOCK_CALLER_IN_PROD is set (escape hatch removed)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_MOCK_CALLER_IN_PROD = 'true';

    await expect(
      ctrl.webhook('mock', 't1', 'sig', nowSec(), reqWith({})),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(mockProvider.parseWebhook).not.toHaveBeenCalled();
    expect(caller.ingest).not.toHaveBeenCalled();
  });

  it('allows the mock provider outside production', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ALLOW_MOCK_CALLER_IN_PROD;
    mockProvider.parseWebhook.mockResolvedValue([
      { providerId: 'mock', callId: 'c2', kind: 'incoming', occurredAt: new Date().toISOString() },
    ]);

    const result = await ctrl.webhook('mock', 't1', 'sig', nowSec(), reqWith({}));
    expect(result.ingested).toBe(1);
    expect(caller.ingest).toHaveBeenCalledTimes(1);
  });

  it('unknown providers stay no-op (registry resolves null) regardless of env', async () => {
    process.env.NODE_ENV = 'production';

    const result = await ctrl.webhook('totally-unknown', 't1', 'sig', nowSec(), reqWith({}));
    expect(result.ingested).toBe(0);
    expect(mockProvider.parseWebhook).not.toHaveBeenCalled();
    expect(caller.ingest).not.toHaveBeenCalled();
  });

  /**
   * Wave-C: the registry path replaces the events=[] stub. A configured
   * generic provider with a valid HMAC signature + fresh timestamp now
   * ingests — and works in production (unlike mock, which is refused).
   */
  it('routes a configured generic provider through the registry and ingests on valid signature', async () => {
    process.env.NODE_ENV = 'production';
    const body = { callId: 'tw-1', kind: 'incoming', e164: '+905551112233' };
    const req = reqWith(body);
    const sig = createHmac('sha256', TWILIO_SECRET)
      .update(req.rawBody)
      .digest('hex');

    const result = await ctrl.webhook('twilio', 't1', sig, nowSec(), req);
    expect(result.ingested).toBe(1);
    expect(caller.ingest).toHaveBeenCalledTimes(1);
    expect(caller.ingest).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ providerId: 'twilio', callId: 'tw-1' }),
    );
  });

  it('rejects a configured generic provider with a bad signature (no ingest)', async () => {
    process.env.NODE_ENV = 'production';
    const req = reqWith({ callId: 'tw-2', kind: 'incoming' });

    await expect(
      ctrl.webhook('twilio', 't1', 'deadbeef', nowSec(), req),
    ).rejects.toThrow(/invalid signature/);
    expect(caller.ingest).not.toHaveBeenCalled();
  });
});
