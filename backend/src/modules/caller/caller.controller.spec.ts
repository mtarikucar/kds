import { ForbiddenException } from '@nestjs/common';
import { CallerController } from './caller.controller';

/**
 * Iter-55 regression for the prod refusal on the mock caller webhook.
 *
 * Before this fix, /v1/caller/webhooks/mock/:tenantId was completely
 * unauthenticated — the mock adapter ignores the x-signature header,
 * and there's no IP allowlist or HMAC layer above. Anyone on the
 * public internet could spam fake calls into any tenant's feed by
 * guessing tenant UUIDs. The fix is the same shape as iter-41's SMS
 * mockMode prod refusal: refuse to dispatch unless ALLOW_MOCK_CALLER_IN_PROD=true.
 */
describe('CallerController.webhook prod refusal (iter-55)', () => {
  const baseEnv = { ...process.env };
  let caller: { ingest: jest.Mock; listRecent: jest.Mock };
  let mockProvider: { parseWebhook: jest.Mock };
  let ctrl: CallerController;

  beforeEach(() => {
    caller = { ingest: jest.fn().mockResolvedValue(undefined), listRecent: jest.fn() };
    mockProvider = { parseWebhook: jest.fn().mockResolvedValue([]) };
    ctrl = new CallerController(caller as any, mockProvider as any);
  });

  afterEach(() => {
    process.env = { ...baseEnv };
  });

  function reqWith(body: any) {
    return { rawBody: Buffer.from(JSON.stringify(body)), body } as any;
  }

  it('throws ForbiddenException in production without the escape hatch', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_MOCK_CALLER_IN_PROD;

    await expect(
      ctrl.webhook('mock', 't1', 'sig', reqWith({ e164: '+1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(mockProvider.parseWebhook).not.toHaveBeenCalled();
    expect(caller.ingest).not.toHaveBeenCalled();
  });

  it('allows the mock provider in production with the explicit escape hatch', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_MOCK_CALLER_IN_PROD = 'true';
    mockProvider.parseWebhook.mockResolvedValue([
      { providerId: 'mock', callId: 'c1', kind: 'incoming', occurredAt: new Date().toISOString() },
    ]);

    const result = await ctrl.webhook('mock', 't1', 'sig', reqWith({}));
    expect(result.ingested).toBe(1);
    expect(caller.ingest).toHaveBeenCalledTimes(1);
  });

  it('allows the mock provider outside production', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ALLOW_MOCK_CALLER_IN_PROD;
    mockProvider.parseWebhook.mockResolvedValue([
      { providerId: 'mock', callId: 'c2', kind: 'incoming', occurredAt: new Date().toISOString() },
    ]);

    const result = await ctrl.webhook('mock', 't1', 'sig', reqWith({}));
    expect(result.ingested).toBe(1);
    expect(caller.ingest).toHaveBeenCalledTimes(1);
  });

  it('non-mock providers stay no-op (registry not wired yet) regardless of env', async () => {
    process.env.NODE_ENV = 'production';

    const result = await ctrl.webhook('twilio', 't1', 'sig', reqWith({}));
    expect(result.ingested).toBe(0);
    expect(mockProvider.parseWebhook).not.toHaveBeenCalled();
    expect(caller.ingest).not.toHaveBeenCalled();
  });
});
