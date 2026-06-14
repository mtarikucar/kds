import { describe, it, expect } from 'vitest';
import { ONBOARDING_STORAGE_KEY, TOUR_STYLES, FEATURE_CARDS } from './constants';

/**
 * Specs for the onboarding constants. FEATURE_CARDS drives the welcome
 * modal grid (each card maps to an i18n title/description key); TOUR_STYLES
 * feeds react-joyride. Pin the i18n key contract and the brand palette so a
 * rename here can't silently break the welcome screen copy or the joyride
 * theme.
 */

describe('ONBOARDING_STORAGE_KEY', () => {
  it('is the persisted store key', () => {
    expect(ONBOARDING_STORAGE_KEY).toBe('onboarding-storage');
  });
});

describe('FEATURE_CARDS', () => {
  it('exposes four cards, each with an icon + i18n key pair', () => {
    expect(FEATURE_CARDS).toHaveLength(4);
    for (const card of FEATURE_CARDS) {
      expect(card.icon).toBeTruthy();
      expect(card.titleKey).toMatch(/^welcome\.features\..+\.title$/);
      expect(card.descriptionKey).toMatch(/^welcome\.features\..+\.description$/);
    }
  });

  it('covers the pos/menu/tables/reports surfaces in order', () => {
    expect(FEATURE_CARDS.map((c) => c.titleKey)).toEqual([
      'welcome.features.pos.title',
      'welcome.features.menu.title',
      'welcome.features.tables.title',
      'welcome.features.reports.title',
    ]);
  });
});

describe('TOUR_STYLES', () => {
  it('uses the brand primary color and a high z-index overlay', () => {
    expect(TOUR_STYLES.options.primaryColor).toBe('#3B82F6');
    expect(TOUR_STYLES.options.zIndex).toBeGreaterThanOrEqual(10000);
    expect(TOUR_STYLES.buttonNext.backgroundColor).toBe('#3B82F6');
  });
});
