import { COUNTRY_PROFILES } from "./country-profile.const";
import {
  formatMoneyNumber,
  formatMoneyForDocument,
  asciiCurrencySuffix,
} from "./money-format";

/**
 * The frontend's useFormatCurrency() (frontend/src/hooks/useFormatCurrency.ts)
 * formats with EXACTLY this Intl.NumberFormat call — same intlLocale, same
 * `style: "currency"`, same currency, same min/max fraction digits both
 * pinned to the profile's displayDecimals. Reproduced verbatim here (not
 * imported — this is a backend package with no access to frontend source)
 * so the "server agrees with the screen" tests below are pinned against the
 * ACTUAL frontend formula, not against this module's own implementation.
 */
function frontendFormat(
  amount: number,
  profile: { intlLocale: string; currency: string; displayDecimals: number },
): string {
  return new Intl.NumberFormat(profile.intlLocale, {
    style: "currency",
    currency: profile.currency,
    minimumFractionDigits: profile.displayDecimals,
    maximumFractionDigits: profile.displayDecimals,
  }).format(amount);
}

describe("money-format", () => {
  const TR = COUNTRY_PROFILES.TR;
  const UZ = COUNTRY_PROFILES.UZ;

  describe("formatMoneyNumber", () => {
    it("groups a TRY amount with Turkish separators and 2 decimals", () => {
      expect(formatMoneyNumber("1234.5", TR)).toBe("1.234,50");
    });

    it("renders a UZS amount with NO decimals — so'm is quoted whole", () => {
      // uz-UZ's Intl grouping separator is U+00A0 (NBSP), not a plain space.
      expect(formatMoneyNumber("150000", UZ)).toBe("150 000");
    });

    it("rounds rather than truncating (UZS 0dp)", () => {
      expect(formatMoneyNumber("149999.6", UZ)).toBe("150 000");
    });

    it("treats a non-finite/garbage amount as zero rather than throwing", () => {
      expect(formatMoneyNumber("not-a-number", TR)).toBe("0,00");
    });
  });

  describe("asciiCurrencySuffix", () => {
    it('is "TL" for TRY (the ₺ glyph has no CP857 codepoint)', () => {
      expect(asciiCurrencySuffix("TRY")).toBe("TL");
    });

    it("falls back to the currency's own ISO code — never a wrong symbol", () => {
      expect(asciiCurrencySuffix("UZS")).toBe("UZS");
      expect(asciiCurrencySuffix("USD")).toBe("USD");
    });
  });

  describe("formatMoneyForDocument", () => {
    it('renders TRY as "₺<amount>" — symbol prefix, 2dp, matches the pre-existing PDF/email shape', () => {
      expect(formatMoneyForDocument(1234.5, TR)).toBe("₺1234.50");
    });

    it('renders UZS as "<amount> soʻm" — suffix placement, 0dp, never "$"', () => {
      const rendered = formatMoneyForDocument(150000, UZ);
      expect(rendered).not.toContain("$");
      expect(rendered).toBe("150000 soʻm");
    });

    it("keeps the pre-existing sign shape for a negative TRY amount (symbol, then signed digits)", () => {
      expect(formatMoneyForDocument(-5, TR)).toBe("₺-5.00");
    });

    it("treats garbage input as zero rather than throwing", () => {
      expect(formatMoneyForDocument("nonsense", TR)).toBe("₺0.00");
    });
  });

  // ── Server ↔ frontend equivalence ───────────────────────────────────────
  // "It must produce the same result as the frontend's useFormatCurrency for
  // the same inputs" — verified explicitly, not assumed. The one disclosed,
  // deliberate divergence is thousands-grouping on formatMoneyForDocument
  // (kept OFF there to preserve the pre-existing, ungrouped TR PDF/email
  // shape — see the module doc comment) — so equivalence is checked at the
  // level that actually matters for "the screen and the receipt disagree
  // about an amount": same rounding, same decimal-PLACE count, same
  // currency glyph/placement. A grouped comparison (formatMoneyNumber vs
  // frontend) proves the digits themselves are identical.
  describe("agreement with the frontend's useFormatCurrency", () => {
    it.each([
      { amount: 0, profile: TR },
      { amount: 1, profile: TR },
      { amount: 1234.5, profile: TR },
      { amount: 999999.99, profile: TR },
      { amount: 0.5, profile: TR },
    ])(
      "TRY $amount: formatMoneyNumber's digits equal the frontend's digits",
      ({ amount, profile }) => {
        const frontend = frontendFormat(amount, profile);
        const serverDigits = formatMoneyNumber(amount, profile);
        // Strip the frontend's currency glyph, leaving just its grouped
        // digit run, and compare against the server's grouped digit run.
        const frontendDigits = frontend.replace(/[^\d.,]/g, "");
        expect(serverDigits).toBe(frontendDigits);
      },
    );

    it.each([
      { amount: 0, profile: UZ },
      { amount: 1, profile: UZ },
      { amount: 150000, profile: UZ },
      { amount: 149999.6, profile: UZ },
    ])(
      "UZS $amount: formatMoneyNumber's digits equal the frontend's digits (0dp both sides)",
      ({ amount, profile }) => {
        const frontend = frontendFormat(amount, profile);
        // Strip everything but digits/separators on BOTH sides — uz-UZ
        // groups with U+00A0 (NBSP), which formatMoneyNumber's grouped
        // output still carries (it's a real grouping character, not
        // punctuation to drop); the frontend's currency-styled string
        // carries the same NBSP plus its "soʻm" glyph. Comparing the
        // stripped digit run on both sides is what proves the two AGREE,
        // not that either one is ungrouped.
        const serverDigits = formatMoneyNumber(amount, profile).replace(
          /[^\d.,]/g,
          "",
        );
        const frontendDigits = frontend.replace(/[^\d.,]/g, "");
        expect(serverDigits).toBe(frontendDigits);
        // The root-cause defect this task fixes: BOTH sides show ZERO
        // fraction digits for UZS — neither a bare "." nor a "," survives
        // the strip above when there are no fraction digits to begin with.
        expect(serverDigits).not.toMatch(/[.,]\d/);
      },
    );

    it("formatMoneyForDocument uses the exact currency glyph Intl gives the frontend (not a hand-typed guess)", () => {
      const frontendUzs = frontendFormat(150000, UZ);
      expect(frontendUzs).toContain("soʻm"); // Intl's real glyph, U+02BB okina — not a plain apostrophe
      expect(formatMoneyForDocument(150000, UZ)).toContain("soʻm");
    });
  });

  // ── Cross-surface agreement ──────────────────────────────────────────────
  // "the Z-Report PDF and the ESC/POS receipt agree on the same amount":
  // the receipt (formatMoneyNumber + asciiCurrencySuffix) and the PDF/email
  // (formatMoneyForDocument) must round to the SAME underlying number for
  // the SAME input — the actual defect being fixed (both used to hardcode
  // their own independent decimal count with no shared source of truth).
  describe("receipt vs document agree on the amount", () => {
    it.each([
      { amount: "1234.56", profile: TR },
      { amount: "150000", profile: UZ },
      { amount: "149999.6", profile: UZ },
    ])("$profile.code $amount", ({ amount, profile }) => {
      const receiptDigits = formatMoneyNumber(amount, profile).replace(
        /[^\d.,-]/g,
        "",
      );
      const documentDigits = formatMoneyForDocument(amount, profile).replace(
        /[^\d.,-]/g,
        "",
      );
      // Normalise both to a plain number for comparison — the receipt is
      // locale-grouped (e.g. "1.234,56"), the document is not
      // (e.g. "1234.56"); what must agree is the numeric VALUE, i.e. the
      // rounding and decimal-place count, not the punctuation.
      const toNumber = (s: string, locale: string) => {
        if (locale === "tr-TR") {
          return Number.parseFloat(s.replace(/\./g, "").replace(",", "."));
        }
        return Number.parseFloat(s.replace(/\s/g, ""));
      };
      expect(toNumber(receiptDigits, profile.intlLocale)).toBeCloseTo(
        toNumber(documentDigits, "other"),
        6,
      );
    });
  });
});
