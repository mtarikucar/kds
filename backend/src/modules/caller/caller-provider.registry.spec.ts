import { createHmac } from 'node:crypto';
import { CallerProviderRegistry } from './caller-provider.registry';

/**
 * Registry replaces the controller's events=[] stub: a configured generic
 * HMAC adapter is selected by providerId and bound to the request tenant +
 * timestamp. Unknown providers (and `mock`) resolve to null so the
 * controller no-ops.
 */
describe('CallerProviderRegistry', () => {
  function configWith(map: Record<string, string>) {
    return { get: (k: string) => map[k] } as any;
  }

  it('resolves a known generic provider to a working HMAC adapter', async () => {
    const registry = new CallerProviderRegistry(
      configWith({ CALLER_WEBHOOK_SECRET__TWILIO: 'whsec_twilio' }),
    );
    const ts = Math.floor(Date.now() / 1000);
    const provider = registry.resolve('twilio', { tenantId: 't1', timestamp: ts });
    expect(provider).not.toBeNull();

    const body = JSON.stringify({ callId: 'c-1', kind: 'incoming' });
    const sig = createHmac('sha256', 'whsec_twilio').update(body).digest('hex');
    const events = await provider!.parseWebhook(sig, Buffer.from(body));
    expect(events).toHaveLength(1);
    expect(events[0].providerId).toBe('twilio');
  });

  it('prefers a per-tenant secret over the provider default', async () => {
    const registry = new CallerProviderRegistry(
      configWith({
        CALLER_WEBHOOK_SECRET__TWILIO: 'provider_default',
        CALLER_WEBHOOK_SECRET__TWILIO__T1: 'tenant_specific',
      }),
    );
    const ts = Math.floor(Date.now() / 1000);
    const provider = registry.resolve('twilio', { tenantId: 't1', timestamp: ts })!;
    const body = JSON.stringify({ callId: 'c-1', kind: 'incoming' });
    const sig = createHmac('sha256', 'tenant_specific').update(body).digest('hex');
    await expect(provider.parseWebhook(sig, Buffer.from(body))).resolves.toHaveLength(1);
  });

  it('returns null for the mock provider (controller owns that path)', () => {
    const registry = new CallerProviderRegistry(configWith({}));
    expect(registry.resolve('mock', { tenantId: 't1' })).toBeNull();
    expect(registry.supports('mock')).toBe(false);
  });

  it('returns null for an unknown provider', () => {
    const registry = new CallerProviderRegistry(configWith({}));
    expect(registry.resolve('nope', { tenantId: 't1' })).toBeNull();
  });

  it('resolves a known provider with no configured secret to a fail-closed adapter', async () => {
    const registry = new CallerProviderRegistry(configWith({}));
    const ts = Math.floor(Date.now() / 1000);
    const provider = registry.resolve('twilio', { tenantId: 't1', timestamp: ts })!;
    const body = JSON.stringify({ callId: 'c-1', kind: 'incoming' });
    const sig = createHmac('sha256', 'anything').update(body).digest('hex');
    await expect(provider.parseWebhook(sig, Buffer.from(body))).rejects.toThrow(
      /secret not configured/,
    );
  });
});
