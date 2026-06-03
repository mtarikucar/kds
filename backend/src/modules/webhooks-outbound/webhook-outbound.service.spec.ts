import { WebhookOutboundService } from './webhook-outbound.service';

/**
 * Sign/verify round-trip + tamper detection. These are the security
 * primitives that protect tenant receivers from spoofed webhooks, so we pin
 * down: a clean round-trip succeeds, a payload tweak invalidates, an old
 * timestamp invalidates, a missing v1 invalidates.
 */
describe('WebhookOutboundService.sign/verify', () => {
  const secret = 'whs_test_secret';
  const body = JSON.stringify({ hello: 'world' });

  it('verifies a freshly signed payload', () => {
    const ts = Date.now();
    const sig = WebhookOutboundService.sign(secret, ts, body);
    expect(WebhookOutboundService.verify(secret, sig, body)).toBe(true);
  });

  it('rejects when the body has been tampered with', () => {
    const ts = Date.now();
    const sig = WebhookOutboundService.sign(secret, ts, body);
    expect(WebhookOutboundService.verify(secret, sig, body + 'x')).toBe(false);
  });

  it('rejects when the secret is wrong', () => {
    const ts = Date.now();
    const sig = WebhookOutboundService.sign(secret, ts, body);
    expect(WebhookOutboundService.verify('whs_different', sig, body)).toBe(false);
  });

  it('rejects when the timestamp is outside the tolerance', () => {
    const oldTs = Date.now() - 10 * 60_000;   // 10 min old
    const sig = WebhookOutboundService.sign(secret, oldTs, body);
    expect(WebhookOutboundService.verify(secret, sig, body, 5 * 60_000)).toBe(false);
  });

  it('rejects when the v1 field is missing', () => {
    const ts = Date.now();
    expect(WebhookOutboundService.verify(secret, `t=${ts}`, body)).toBe(false);
  });
});
