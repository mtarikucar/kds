import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { IMG, type ImgKey } from "./images";

// Guards against a data/asset drift: every image referenced by the landing
// pages must have its optimized webp derivatives generated on disk and a
// non-empty alt text.
describe("marketing image map", () => {
  const keys = Object.keys(IMG) as ImgKey[];

  it("references 20 images", () => {
    expect(keys).toHaveLength(20);
  });

  // Root-cause regression guard: /marketing/* is relayed (301) to the decoupled
  // marketing.hummytummy.com app in prod, so images MUST NOT live there.
  it("images are served from /brand/, never the relayed /marketing/ path", () => {
    for (const key of keys) {
      expect(
        IMG[key].src.startsWith("/marketing/"),
        `${key} src uses reserved /marketing/`,
      ).toBe(false);
      expect(
        IMG[key].srcSm.startsWith("/marketing/"),
        `${key} srcSm uses reserved /marketing/`,
      ).toBe(false);
      expect(IMG[key].src.startsWith("/brand/")).toBe(true);
    }
  });

  it.each(keys)("%s: lg + sm webp files exist and alt is set", (key) => {
    const i = IMG[key];
    expect(i.alt.trim().length).toBeGreaterThan(0);
    expect(i.w).toBeGreaterThan(0);
    expect(i.h).toBeGreaterThan(0);
    expect(existsSync(path.join(process.cwd(), "public", i.src))).toBe(true);
    expect(existsSync(path.join(process.cwd(), "public", i.srcSm))).toBe(true);
  });
});
