import {
  MERCHANT_OID_PREFIX,
  generateMerchantOid,
} from './self-pay-merchant-oid.util';

/**
 * Spec for the self-pay merchant-OID minter. Shape contract:
 *   SP<tenantHex(<=12, no dashes)><base36 ts><6 hex random>
 * The "SP" prefix is what PaytrWebhookController dispatches on, so it must
 * be present and stable; the random suffix must vary between calls.
 */
describe('generateMerchantOid', () => {
  const tenantId = '6b0b887d-c741-4f8f-9f3f-08501f075aef';

  it('starts with the SP dispatch prefix', () => {
    expect(generateMerchantOid(tenantId).startsWith(MERCHANT_OID_PREFIX)).toBe(true);
    expect(MERCHANT_OID_PREFIX).toBe('SP');
  });

  it('embeds the first 12 dash-stripped tenant hex chars', () => {
    const oid = generateMerchantOid(tenantId);
    const tenantHex = tenantId.replace(/-/g, '').slice(0, 12);
    expect(oid.startsWith(`SP${tenantHex}`)).toBe(true);
    expect(oid).not.toContain('-');
  });

  it('ends with a 6-char hex random suffix', () => {
    const oid = generateMerchantOid(tenantId);
    expect(oid.slice(-6)).toMatch(/^[0-9a-f]{6}$/);
  });

  it('produces a different OID on each call (unguessable suffix)', () => {
    const a = generateMerchantOid(tenantId);
    const b = generateMerchantOid(tenantId);
    expect(a).not.toBe(b);
  });
});
