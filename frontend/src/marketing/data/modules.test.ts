import { describe, it, expect } from 'vitest';
import { MODULES, CATEGORIES } from './modules';
import { IMG } from './images';

describe('marketing modules', () => {
  it('defines all 17 modules', () => {
    expect(MODULES).toHaveLength(17);
  });

  it('has unique slugs and anchors', () => {
    expect(new Set(MODULES.map((m) => m.slug)).size).toBe(17);
    expect(new Set(MODULES.map((m) => m.anchor)).size).toBe(17);
  });

  it('every module belongs to a known category', () => {
    for (const m of MODULES) {
      expect(CATEGORIES).toContain(m.category);
    }
  });

  it('every module image key exists in the image map', () => {
    for (const m of MODULES) {
      expect(IMG[m.imageKey]).toBeDefined();
    }
  });

  it('every module has at least 3 bullets and a tagline', () => {
    for (const m of MODULES) {
      expect(m.bullets.length).toBeGreaterThanOrEqual(3);
      expect(m.tagline.trim().length).toBeGreaterThan(0);
    }
  });
});
