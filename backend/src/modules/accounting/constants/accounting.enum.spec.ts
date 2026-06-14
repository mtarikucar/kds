import {
  TaxRate,
  DEFAULT_TAX_RATE,
  InvoiceStatus,
  AccountingProvider,
  InvoiceType,
} from "./accounting.enum";

/**
 * Long-tail drift-guard for the accounting enums. These values key the
 * provider dispatch (Parasut/Logo/Foriba) and the TR VAT buckets, so we pin
 * the load-bearing numeric tax rates and the default, plus the provider set.
 */
describe("accounting.enum", () => {
  it("exposes the TR VAT rates as numeric values", () => {
    expect(TaxRate.ZERO).toBe(0);
    expect(TaxRate.ONE).toBe(1);
    expect(TaxRate.TEN).toBe(10);
    expect(TaxRate.TWENTY).toBe(20);
  });

  it("defaults the tax rate to 10%", () => {
    expect(DEFAULT_TAX_RATE).toBe(TaxRate.TEN);
  });

  it("enumerates the accounting providers including NONE", () => {
    expect(Object.values(AccountingProvider)).toEqual(
      expect.arrayContaining(["NONE", "PARASUT", "LOGO", "FORIBA"]),
    );
  });

  it("keeps the invoice status + type lifecycles", () => {
    expect(InvoiceStatus.DRAFT).toBe("DRAFT");
    expect(InvoiceStatus.CANCELLED).toBe("CANCELLED");
    expect(InvoiceType.SALES).toBe("SALES");
    expect(InvoiceType.REFUND).toBe("REFUND");
  });
});
