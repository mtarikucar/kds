import { describe, it, expect } from 'vitest';
import { prettyKey, prettyValue, localizeDetails } from './productDetailHelpers';

/**
 * Unit spec for the extracted ProductDetailPage helpers (v2.8.87). These
 * were module-private; localizeDetails now takes `lang` explicitly instead
 * of reading document.documentElement.lang.
 */
describe('prettyKey', () => {
  it('camelCase -> spaced Title-cased first letter', () => {
    expect(prettyKey('batteryLife')).toBe('Battery Life');
  });

  it('snake_case underscores become spaces', () => {
    expect(prettyKey('max_resolution')).toBe('Max resolution');
  });

  it('uppercases the first character', () => {
    expect(prettyKey('weight')).toBe('Weight');
  });
});

describe('prettyValue', () => {
  it('renders null / undefined as an em-dash', () => {
    expect(prettyValue(null)).toBe('—');
    expect(prettyValue(undefined)).toBe('—');
  });

  it('joins arrays with a comma + space, stringifying members', () => {
    expect(prettyValue(['a', 1, true])).toBe('a, 1, true');
  });

  it('JSON-stringifies a plain object', () => {
    expect(prettyValue({ a: 1 })).toBe('{"a":1}');
  });

  it('stringifies primitives', () => {
    expect(prettyValue(42)).toBe('42');
    expect(prettyValue('hi')).toBe('hi');
    expect(prettyValue(false)).toBe('false');
  });
});

describe('localizeDetails', () => {
  it('returns {} for non-object input', () => {
    expect(localizeDetails(null, 'tr')).toEqual({});
    expect(localizeDetails('nope', 'tr')).toEqual({});
    expect(localizeDetails(42, 'en')).toEqual({});
  });

  it('returns a flat object verbatim when not locale-keyed', () => {
    const flat = { requirements: ['x', 'y'], faq: [{ q: 'q', a: 'a' }] };
    expect(localizeDetails(flat, 'en')).toEqual(flat);
  });

  it('picks the requested language from a locale-keyed object', () => {
    const keyed = {
      tr: { requirements: ['tr-req'] },
      en: { requirements: ['en-req'] },
    };
    expect(localizeDetails(keyed, 'en')).toEqual({ requirements: ['en-req'] });
    expect(localizeDetails(keyed, 'tr')).toEqual({ requirements: ['tr-req'] });
  });

  it('falls back to tr, then en, then {} when the lang key is missing', () => {
    const onlyTr = { tr: { includes: ['t'] } };
    expect(localizeDetails(onlyTr, 'de')).toEqual({ includes: ['t'] });

    const onlyEn = { en: { includes: ['e'] } };
    expect(localizeDetails(onlyEn, 'de')).toEqual({ includes: ['e'] });
  });
});
