import { describe, it, expect } from 'vitest';
import { SECTOR_CONTENT, SECTOR_SLUGS, getSectorCopy, SECTORS } from './sectorContent';
import { IMG } from './images';
import { MODULE_SLUGS } from './moduleContent';

describe('sector solution content', () => {
  it('has generated copy for all 9 sectors', () => {
    for (const slug of SECTOR_SLUGS) {
      expect(SECTOR_CONTENT[slug], `missing sector: ${slug}`).toBeDefined();
    }
    expect(Object.keys(SECTOR_CONTENT).length).toBe(9);
    expect(SECTOR_SLUGS).not.toContain('otel'); // no PMS → no hotel sector
  });

  it.each(SECTOR_SLUGS)('%s: content is deep enough', (slug) => {
    const c = getSectorCopy(slug)!;
    expect(c.hero.title.trim().length).toBeGreaterThan(0);
    expect(c.intro.length).toBeGreaterThan(120);
    expect(c.blocks.length).toBeGreaterThanOrEqual(3);
    expect(c.why.length).toBeGreaterThanOrEqual(4);
    expect(c.faq.length).toBeGreaterThanOrEqual(4);
    expect(c.ctaTitle.trim().length).toBeGreaterThan(0);
  });

  it.each(SECTORS)('$slug: hero image + featured module slugs are valid', (s) => {
    expect(IMG[s.heroImage]).toBeDefined();
    expect(s.moduleSlugs.length).toBeGreaterThanOrEqual(4);
    s.moduleSlugs.forEach((m) => expect(MODULE_SLUGS).toContain(m));
  });

  it('delivery-heavy sectors lean on platform integration, not own-courier', () => {
    // We lack own-courier GPS dispatch. Delivery must be framed as aggregator
    // integration; if courier/GPS is mentioned at all it must be a DISCLAIMER.
    for (const slug of ['pizza', 'fast-food', 'bulut-mutfak']) {
      const blob = JSON.stringify(getSectorCopy(slug)).toLocaleLowerCase('tr');
      expect(blob, `${slug} should mention delivery platforms`).toMatch(/yemeksepeti|getir|trendyol|migros/);
      if (blob.includes('gps') || blob.includes('kurye takip')) {
        expect(blob, `${slug} mentions courier/GPS — must disclaim it`).toMatch(/sunmaz|sunmuyoruz|bulunmuyor|yoktur|\byok\b|değil/);
      }
    }
  });
});
