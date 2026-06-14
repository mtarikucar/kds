import { describe, it, expect } from 'vitest';
import { normalizePairCode } from './pairingLogic';

describe('normalizePairCode', () => {
  it('upper-cases lower-case input', () => {
    expect(normalizePairCode('a4f9k2')).toBe('A4F9K2');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizePairCode('  A4F9K2  ')).toBe('A4F9K2');
    expect(normalizePairCode('\tA4F9K2\n')).toBe('A4F9K2');
  });

  it('trims and upper-cases together', () => {
    expect(normalizePairCode('  a4f9k2 ')).toBe('A4F9K2');
  });

  it('leaves an already-normalized code unchanged', () => {
    expect(normalizePairCode('A4F9K2')).toBe('A4F9K2');
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(normalizePairCode('   ')).toBe('');
  });
});
