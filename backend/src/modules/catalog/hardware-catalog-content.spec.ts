import {
  PRODUCTS,
  SEED_DEFAULT_COMPLIANCE,
} from "../../../prisma/seeds/seed-marketplace";
import { CATEGORY_DEFAULT_SALE_MODE } from "./dto/create-hardware-product.dto";
import { CATEGORY_VALUES } from "./category-vocabulary";

/**
 * Task 11 catalog-content invariants — regression guards for 3 seed-data
 * defects found by the hardware audit:
 *
 *  1. "Rent" acquisition has no monthly-billing rail behind it (PayTR only
 *     charges once), so the catalog must not OFFER rent on any SKU right
 *     now. `rentalMonthlyCents` returns once a recurring-billing rail
 *     exists — this is a "not yet", not a schema/column removal (the
 *     column, the DTO field, and QuoteService's defensive `acquisition ===
 *     'rent'` branch all stay).
 *  2. `SEED_DEFAULT_COMPLIANCE` used to carry a fabricated support phone
 *     number ("0850 000 00 00") and two dead links to compliance PDFs that
 *     were never actually uploaded anywhere — both rendered to real tenants
 *     on the storefront's "Yasal & Garanti" tab.
 *  3. Ingenico Move/5000F is a bank/PSP card-payment terminal, not a YN ÖKC
 *     fiscal cash register — it must live in the `pos_terminal` category
 *     (which resolves the real, implemented `PARTNER_REDIRECT` regulatory
 *     tier), not `yazarkasa` (which resolves `QUOTE_ONLY`, the fiscal-
 *     dealer tier).
 */
describe("hardware catalog content (seed-marketplace)", () => {
  it("no product in the catalog offers rent — no monthly-billing rail exists yet", () => {
    const rentable = PRODUCTS.filter(
      (p): p is typeof p & { rentalMonthlyCents: number } =>
        (p as { rentalMonthlyCents?: number | null }).rentalMonthlyCents !=
        null,
    );
    expect(rentable.map((p) => p.sku)).toEqual([]);
  });

  it("SEED_DEFAULT_COMPLIANCE does not carry a fabricated support phone number", () => {
    const serialized = JSON.stringify(SEED_DEFAULT_COMPLIANCE);
    expect(serialized).not.toMatch(/0850[\s-]?000[\s-]?00[\s-]?00/);
  });

  it("SEED_DEFAULT_COMPLIANCE does not link to compliance documents that were never actually uploaded", () => {
    const docs = SEED_DEFAULT_COMPLIANCE as Record<string, unknown>;
    expect(docs.warrantyCertUrl).toBeUndefined();
    expect(docs.returnTermsUrl).toBeUndefined();
    expect(docs.serviceInfo).toBeUndefined();
  });

  it("SEED_DEFAULT_COMPLIANCE still satisfies the DIRECT_SALE publish gate (at least one non-empty value)", () => {
    const hasNonEmptyValue = Object.values(SEED_DEFAULT_COMPLIANCE).some(
      (v) => v !== null && v !== undefined && v !== "" && v !== false,
    );
    expect(hasNonEmptyValue).toBe(true);
  });

  it("Ingenico Move/5000F (bank POS terminal) is categorized pos_terminal, not yazarkasa", () => {
    const ingenico = PRODUCTS.find(
      (p) => p.sku === "yazarkasa-ingenico-move5000f",
    );
    expect(ingenico).toBeDefined();
    expect(ingenico!.category).toBe("pos_terminal");
  });

  it("Ingenico no longer claims GİB fiscal certification (that applies to YN ÖKC devices, not bank POS terminals)", () => {
    const ingenico = PRODUCTS.find(
      (p) => p.sku === "yazarkasa-ingenico-move5000f",
    );
    const compat = (ingenico as { compat?: Record<string, unknown> } | undefined)
      ?.compat;
    expect(compat?.gibCertified).not.toBe(true);
  });

  it("pos_terminal is a real category with a real, implemented sale mode (PARTNER_REDIRECT) — not a dead bucket", () => {
    expect(CATEGORY_VALUES).toContain("pos_terminal");
    expect(CATEGORY_DEFAULT_SALE_MODE["pos_terminal"]).toBe(
      "PARTNER_REDIRECT",
    );
  });
});
