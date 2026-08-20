import {
  ALACARTE_CATALOG,
  ALACARTE_CATALOG_BY_CODE,
} from "./alacarte-catalog.const";
import { AVAILABLE_DELIVERY_PLATFORMS } from "../delivery-platforms/constants/platform.enum";

/**
 * The bridge between what we SELL and what we can RUN.
 *
 * The bundle grant lists lowercase vendor ids while the adapter dictionary is
 * an uppercase enum, and the two do not map by case alone (TRENDYOL <->
 * "trendyol_yemek"). Nothing in the codebase joins them, so the day a fifth
 * platform ships, one side can move without the other and the only symptom is
 * a tenant who bought "all four" and cannot use one of them. This spec is that
 * join, written down.
 */
describe("delivery bundle <-> platform dictionary", () => {
  it("the bundle's vendor ids cover exactly the available platforms", () => {
    const bundle = ALACARTE_CATALOG_BY_CODE.get("delivery_platforms")!;
    const vendors = bundle.grants["integration.delivery"] as string[];
    expect(vendors.length).toBe(AVAILABLE_DELIVERY_PLATFORMS.length);
    // The pairing is pinned EXPLICITLY because it cannot be derived: vendor
    // ids are lowercase and TRENDYOL's id carries a "_yemek" suffix.
    expect(vendors).toEqual([
      "yemeksepeti",
      "getir",
      "trendyol_yemek",
      "migros",
    ]);
  });

  it("does not sell Semt", () => {
    // Semt is free and not built. A published zero-price catalog row would
    // punch straight through purchase()'s payment gate, so there is no row at
    // all — and the bundle must not smuggle it in as a fifth vendor.
    const bundle = ALACARTE_CATALOG_BY_CODE.get("delivery_platforms")!;
    expect(bundle.grants["integration.delivery"]).not.toContain("semt");
    expect(ALACARTE_CATALOG.some((p) => p.code.includes("semt"))).toBe(false);
  });
});
