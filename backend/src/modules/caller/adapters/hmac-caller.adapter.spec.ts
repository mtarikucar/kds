import { createHmac } from 'node:crypto';
import { HmacCallerAdapter } from './hmac-caller.adapter';

/**
 * Generic HMAC caller adapter. Provider-agnostic: HMAC-SHA256 over the raw
 * body, hex digest, constant-time compare via the shared verifyHmacHex, plus
 * a 300s timestamp freshness window for replay protection.
 *
 * Provider-specific signing quirks (sha512, base64, timestamp-in-payload,
 * header naming) are DEFERRED until a real provider contract lands.
 */
describe('HmacCallerAdapter.parseWebhook', () => {
  const SECRET = 'whsec_caller_test';
  const nowSec = () => Math.floor(Date.now() / 1000);

  function sign(body: string): string {
    return createHmac('sha256', SECRET).update(body).digest('hex');
  }

  function adapter(opts?: { secret?: string | undefined; ts?: string | number }) {
    return new HmacCallerAdapter('twilio', opts && 'secret' in opts ? opts.secret : SECRET, {
      tenantId: 't1',
      timestamp: opts?.ts ?? nowSec(),
    });
  }

  it('accepts a valid signature and normalises the event', async () => {
    const body = JSON.stringify({ callId: 'c-1', kind: 'incoming', e164: '+905551112233' });
    const events = await adapter().parseWebhook(sign(body), Buffer.from(body));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      providerId: 'twilio',
      callId: 'c-1',
      kind: 'incoming',
      e164: '+905551112233',
    });
  });

  it('rejects a tampered body (signature no longer matches)', async () => {
    const signed = JSON.stringify({ callId: 'c-1', kind: 'incoming' });
    const tampered = JSON.stringify({ callId: 'c-1', kind: 'answered' });
    await expect(
      adapter().parseWebhook(sign(signed), Buffer.from(tampered)),
    ).rejects.toThrow(/invalid signature/);
  });

  it('rejects a tampered/garbage signature', async () => {
    const body = JSON.stringify({ callId: 'c-1', kind: 'incoming' });
    await expect(
      adapter().parseWebhook('deadbeef', Buffer.from(body)),
    ).rejects.toThrow(/invalid signature/);
  });

  it('rejects a stale timestamp outside the 300s window', async () => {
    const body = JSON.stringify({ callId: 'c-1', kind: 'incoming' });
    const stale = nowSec() - 301;
    await expect(
      adapter({ ts: stale }).parseWebhook(sign(body), Buffer.from(body)),
    ).rejects.toThrow(/stale webhook timestamp/);
  });

  it('rejects a missing timestamp (fail closed)', async () => {
    const body = JSON.stringify({ callId: 'c-1', kind: 'incoming' });
    await expect(
      adapter({ ts: '' }).parseWebhook(sign(body), Buffer.from(body)),
    ).rejects.toThrow(/missing webhook timestamp/);
  });

  it('throws when the per-tenant secret is missing (fail closed)', async () => {
    const body = JSON.stringify({ callId: 'c-1', kind: 'incoming' });
    await expect(
      adapter({ secret: undefined }).parseWebhook(sign(body), Buffer.from(body)),
    ).rejects.toThrow(/secret not configured/);
  });

  it('accepts a millisecond timestamp (normalised to seconds)', async () => {
    const body = JSON.stringify({ callId: 'c-1', kind: 'incoming' });
    const events = await adapter({ ts: Date.now() }).parseWebhook(
      sign(body),
      Buffer.from(body),
    );
    expect(events).toHaveLength(1);
  });

  it('coerces an unknown kind to "incoming"', async () => {
    const body = JSON.stringify({ callId: 'c-1', kind: 'bogus' });
    const events = await adapter().parseWebhook(sign(body), Buffer.from(body));
    expect(events[0].kind).toBe('incoming');
  });
});
