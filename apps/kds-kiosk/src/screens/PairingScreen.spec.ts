import { describe, it, expect } from 'vitest';
import { validateApiUrl } from './PairingScreen';

/**
 * deep-review NM5: the pair code is a bearer secret, so the API URL it is sent
 * to must be validated (https + host allow-list) before submit.
 */
describe('validateApiUrl', () => {
  it('accepts the production host and strips a trailing slash', () => {
    expect(validateApiUrl('https://hummytummy.com/api')).toBe('https://hummytummy.com/api');
    expect(validateApiUrl('https://hummytummy.com/api/')).toBe('https://hummytummy.com/api');
    expect(validateApiUrl('  https://hummytummy.com/api  ')).toBe('https://hummytummy.com/api');
  });

  it('accepts subdomains of an allow-listed host', () => {
    expect(validateApiUrl('https://kds.hummytummy.com/api')).toBe('https://kds.hummytummy.com/api');
  });

  it('rejects non-https schemes', () => {
    expect(() => validateApiUrl('http://hummytummy.com/api')).toThrow(/https/);
  });

  it('rejects hosts that are not allow-listed', () => {
    expect(() => validateApiUrl('https://evil.example.com/api')).toThrow(/not allowed/);
  });

  it('rejects a host that merely contains the allow-listed host as a suffix-without-dot', () => {
    // "evilhummytummy.com" must not be treated as a subdomain of hummytummy.com
    expect(() => validateApiUrl('https://evilhummytummy.com/api')).toThrow(/not allowed/);
  });

  it('rejects unparseable input', () => {
    expect(() => validateApiUrl('not a url')).toThrow(/Invalid API URL/);
  });
});
