import { maskEmail, maskPhone } from './pii-mask.helper';

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

describe('maskPhone', () => {
  it('masks TR numbers keeping +90 country code and last 2 digits', () => {
    expect(maskPhone('+905551112233')).toBe('+90****33');
  });

  it('masks US-style numbers keeping +1 country code', () => {
    // +1 has 1-digit country code, but our cheap rule keeps "+1" only when
    // the prefix is "+9"; otherwise it keeps the first 2 chars "+1".
    expect(maskPhone('+15551112233')).toBe('+1****33');
  });

  it('masks numbers without leading + with no country-code segment', () => {
    expect(maskPhone('5551112233')).toBe('***33');
  });

  it('fully masks too-short inputs', () => {
    expect(maskPhone('abc')).toBe('***');
    expect(maskPhone('12')).toBe('***');
  });

  it('returns empty for null / undefined / empty', () => {
    expect(maskPhone('')).toBe('');
    expect(maskPhone(null)).toBe('');
    expect(maskPhone(undefined)).toBe('');
  });

  it('trims surrounding whitespace before masking', () => {
    expect(maskPhone('  +905551112233  ')).toBe('+90****33');
  });
});
