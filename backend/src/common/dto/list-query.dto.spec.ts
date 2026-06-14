import { sanitizePage, LIST_QUERY_HARD_MAX } from './list-query.dto';

/**
 * Wave-C ADDITIVE pagination backstop. sanitizePage is the service-layer
 * translator from optional {limit, offset} into Prisma {take, skip}. Its
 * core contract: "no params => full list" must stay byte-identical (both
 * undefined), and junk values must collapse to undefined rather than
 * reaching Prisma as NaN (which would 500).
 */
describe('sanitizePage', () => {
  it('returns undefined take/skip when nothing is passed (full-list default)', () => {
    expect(sanitizePage()).toEqual({ take: undefined, skip: undefined });
    expect(sanitizePage({})).toEqual({ take: undefined, skip: undefined });
  });

  it('forwards a valid limit/offset unchanged', () => {
    expect(sanitizePage({ limit: 25, offset: 50 })).toEqual({
      take: 25,
      skip: 50,
    });
  });

  it('allows offset 0 (skip nothing) without coercing it away', () => {
    expect(sanitizePage({ limit: 10, offset: 0 })).toEqual({
      take: 10,
      skip: 0,
    });
  });

  it('clamps a limit above the hard max down to the cap', () => {
    expect(sanitizePage({ limit: 9_999_999 }).take).toBe(LIST_QUERY_HARD_MAX);
  });

  it('drops a NaN limit to undefined (junk ?limit=banana parsed to NaN)', () => {
    expect(sanitizePage({ limit: NaN }).take).toBeUndefined();
  });

  it('drops a zero / negative / non-integer limit to undefined', () => {
    expect(sanitizePage({ limit: 0 }).take).toBeUndefined();
    expect(sanitizePage({ limit: -5 }).take).toBeUndefined();
    expect(sanitizePage({ limit: 3.7 }).take).toBeUndefined();
  });

  it('drops a NaN / negative / non-integer offset to undefined', () => {
    expect(sanitizePage({ offset: NaN }).skip).toBeUndefined();
    expect(sanitizePage({ offset: -1 }).skip).toBeUndefined();
    expect(sanitizePage({ offset: 2.5 }).skip).toBeUndefined();
  });

  it('treats each field independently (junk limit + valid offset)', () => {
    expect(sanitizePage({ limit: NaN, offset: 10 })).toEqual({
      take: undefined,
      skip: 10,
    });
  });
});
