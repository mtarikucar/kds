import { PROCUREMENT_GUIDE } from './procurement-guide.data';

describe('PROCUREMENT_GUIDE integrity', () => {
  const ids = new Set(PROCUREMENT_GUIDE.sources.map((s) => s.id));

  it('every channel source id resolves', () => {
    for (const c of PROCUREMENT_GUIDE.categories)
      for (const ch of c.channels)
        for (const sid of ch.sourceIds) expect(ids.has(sid)).toBe(true);
  });

  it('every category recommends for all three tiers', () => {
    for (const c of PROCUREMENT_GUIDE.categories)
      for (const tier of ['SMALL_CAFE', 'MID_RESTAURANT', 'MULTI_BRANCH'] as const)
        expect(c.recommendationKeyByTier[tier]).toBeTruthy();
  });

  it('has all 7 categories', () => {
    const keys = PROCUREMENT_GUIDE.categories.map((c) => c.categoryKey).sort();
    expect(keys).toEqual(
      ['BEVERAGE', 'CLEANING', 'DAIRY', 'DRY_GOODS', 'MEAT', 'PACKAGING', 'PRODUCE'].sort(),
    );
  });

  it('every category has at least one channel and 2-3 rule keys', () => {
    for (const c of PROCUREMENT_GUIDE.categories) {
      expect(c.channels.length).toBeGreaterThan(0);
      expect(c.ruleKeys.length).toBeGreaterThanOrEqual(2);
      expect(c.ruleKeys.length).toBeLessThanOrEqual(3);
    }
  });

  it('every channel has a rank for all three tiers and non-empty note keys', () => {
    for (const c of PROCUREMENT_GUIDE.categories) {
      for (const ch of c.channels) {
        for (const tier of ['SMALL_CAFE', 'MID_RESTAURANT', 'MULTI_BRANCH'] as const) {
          expect(ch.rankForTier[tier]).toBeDefined();
        }
        expect(ch.advantageNoteKey).toBeTruthy();
        expect(ch.minOrderNoteKey).toBeTruthy();
        expect(ch.paymentNoteKey).toBeTruthy();
        expect(ch.eInvoiceNoteKey).toBeTruthy();
      }
    }
  });

  it('every source has full citation metadata', () => {
    for (const s of PROCUREMENT_GUIDE.sources) {
      expect(s.id).toBeTruthy();
      expect(s.title).toBeTruthy();
      expect(s.publisher).toBeTruthy();
      expect(s.url).toMatch(/^https?:\/\//);
      expect(s.accessedAt).toBe('2026-07-22');
    }
  });

  it('sourceIds arrays contain no duplicates', () => {
    for (const c of PROCUREMENT_GUIDE.categories)
      for (const ch of c.channels)
        expect(new Set(ch.sourceIds).size).toBe(ch.sourceIds.length);
  });
});
