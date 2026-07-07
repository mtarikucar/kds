import { describe, it, expect } from "vitest";
import { MODULES } from "./modules";
import { IMG } from "./images";

describe("marketing modules", () => {
  it("defines exactly 8 modules", () => {
    expect(MODULES).toHaveLength(8);
  });

  it("has unique slugs and anchors", () => {
    expect(new Set(MODULES.map((m) => m.slug)).size).toBe(8);
    expect(new Set(MODULES.map((m) => m.anchor)).size).toBe(8);
  });

  it("every module image key exists in the image map", () => {
    for (const m of MODULES) {
      expect(IMG[m.imageKey]).toBeDefined();
    }
  });

  it("every module has at least 3 bullets and a tagline", () => {
    for (const m of MODULES) {
      expect(m.bullets.length).toBeGreaterThanOrEqual(3);
      expect(m.tagline.trim().length).toBeGreaterThan(0);
    }
  });
});
