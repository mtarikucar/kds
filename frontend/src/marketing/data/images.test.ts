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

  it.each(keys)("%s: lg + sm webp files exist and alt is set", (key) => {
    const i = IMG[key];
    expect(i.alt.trim().length).toBeGreaterThan(0);
    expect(i.w).toBeGreaterThan(0);
    expect(i.h).toBeGreaterThan(0);
    expect(existsSync(path.join(process.cwd(), "public", i.src))).toBe(true);
    expect(existsSync(path.join(process.cwd(), "public", i.srcSm))).toBe(true);
  });
});
