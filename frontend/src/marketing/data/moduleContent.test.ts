import { describe, it, expect } from "vitest";
import {
  MODULE_CONTENT,
  CONTENT_META,
  getModuleCopy,
  MODULE_SLUGS,
} from "./moduleContent";
import { IMG } from "./images";

// Ensures the deep-dive pages actually have rich, generated copy (not the thin
// fallback) and that every referenced image key is valid.
describe("module deep-dive content", () => {
  it("has generated copy for all 17 modules (not fallback)", () => {
    for (const slug of MODULE_SLUGS) {
      expect(MODULE_CONTENT[slug], `missing content: ${slug}`).toBeDefined();
    }
    expect(Object.keys(MODULE_CONTENT).length).toBe(17);
  });

  it.each(MODULE_SLUGS)("%s: content is deep enough (adisyo-style)", (slug) => {
    const c = getModuleCopy(slug)!;
    expect(c.hero.eyebrow.trim().length).toBeGreaterThan(0);
    expect(c.hero.title.trim().length).toBeGreaterThan(0);
    expect(c.intro.length).toBeGreaterThan(120);
    expect(c.blocks.length).toBeGreaterThanOrEqual(3);
    c.blocks.forEach((b) => expect(b.bullets.length).toBeGreaterThanOrEqual(3));
    expect(c.how.steps.length).toBeGreaterThanOrEqual(3);
    expect(c.advantages.length).toBeGreaterThanOrEqual(4);
    expect(c.faq.length).toBeGreaterThanOrEqual(4);
    expect(c.ctaTitle.trim().length).toBeGreaterThan(0);
  });

  it.each(MODULE_SLUGS)("%s: meta images + related slugs are valid", (slug) => {
    const meta = CONTENT_META[slug];
    expect(meta).toBeDefined();
    expect(IMG[meta.heroImage]).toBeDefined();
    meta.blockImages.forEach((k) => expect(IMG[k]).toBeDefined());
    meta.related.forEach((r) => expect(MODULE_SLUGS).toContain(r));
  });

  it("has no leftover HTML entities in generated copy", () => {
    const blob = JSON.stringify(MODULE_CONTENT);
    expect(blob).not.toContain("&amp;");
    expect(blob).not.toContain("&#39;");
  });
});
