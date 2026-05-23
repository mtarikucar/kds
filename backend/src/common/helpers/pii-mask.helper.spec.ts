import { maskEmail } from './pii-mask.helper';

describe('maskEmail', () => {
  it('masks the local part keeping first character and domain', () => {
    expect(maskEmail('alice@example.com')).toBe('a***@example.com');
    expect(maskEmail('bob.smith@host.com')).toBe('b***@host.com');
  });

  it('fully masks single-character local parts', () => {
    // Keeping the first char would leak the whole local part.
    expect(maskEmail('x@host.com')).toBe('*@host.com');
  });

  it('returns *** for input without an @', () => {
    expect(maskEmail('no-at-sign')).toBe('***');
  });

  it('returns *** when @ is the first character (no local part)', () => {
    expect(maskEmail('@host.com')).toBe('***');
  });

  it('returns empty string for null / undefined / empty', () => {
    expect(maskEmail('')).toBe('');
    expect(maskEmail(null)).toBe('');
    expect(maskEmail(undefined)).toBe('');
  });

  it('preserves the full domain (so debugging different mail providers stays possible)', () => {
    expect(maskEmail('admin@hummytummy.com')).toBe('a***@hummytummy.com');
    expect(maskEmail('admin@gmail.com')).toBe('a***@gmail.com');
  });
});
