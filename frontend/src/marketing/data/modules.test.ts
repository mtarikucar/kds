import { describe, it, expect } from "vitest";
import { MODULES, CATEGORIES } from "./modules";
import { IMG } from "./images";

describe("marketing modules", () => {
  // 16, not 17: `analitik` was removed because its copy is entirely about the
  // camera heat map, which ships inert behind CAMERA_ANALYTICS_ENABLED. Raising
  // this number again belongs in the change that enables the flag.
  it("defines all 16 modules", () => {
    expect(MODULES).toHaveLength(16);
  });

  it("has unique slugs and anchors", () => {
    expect(new Set(MODULES.map((m) => m.slug)).size).toBe(16);
    expect(new Set(MODULES.map((m) => m.anchor)).size).toBe(16);
  });

  it("does not advertise a module whose feature is switched off", () => {
    expect(MODULES.map((m) => m.slug)).not.toContain("analitik");
  });

  it("every module belongs to a known category", () => {
    for (const m of MODULES) {
      expect(CATEGORIES).toContain(m.category);
    }
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
