import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdateAccountingSettingsDto } from "./accounting-settings.dto";
import {
  CreateSalesInvoiceDto,
  InvoiceQueryDto,
} from "./create-sales-invoice.dto";
import { RequestContext } from "../../../common/context/request-context";

/**
 * Long-tail validation spec for the accounting DTOs. Load-bearing rules:
 * provider is a closed set; the TR tax id is 10 (VKN) or 11 (TCKN) digits
 * (rejected here so the operator sees it at write time, not after a sync
 * round-trip); the invoice query caps limit at 200 (DoS guard); string
 * booleans coerce.
 */
async function errs(dto: object): Promise<string[]> {
  const results = await validate(dto);
  return results.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe("UpdateAccountingSettingsDto", () => {
  it("coerces a string boolean and accepts a valid provider", async () => {
    const dto = plainToInstance(UpdateAccountingSettingsDto, {
      autoGenerateInvoice: "true",
      provider: "PARASUT",
    });
    expect(await errs(dto)).toEqual([]);
    expect(dto.autoGenerateInvoice).toBe(true);
  });

  it("rejects an unknown provider", async () => {
    const dto = plainToInstance(UpdateAccountingSettingsDto, {
      provider: "QUICKBOOKS",
    });
    expect((await errs(dto)).some((m) => /provider/.test(m))).toBe(true);
  });

  it("rejects nextInvoiceNumber below 1", async () => {
    const dto = plainToInstance(UpdateAccountingSettingsDto, {
      nextInvoiceNumber: "0",
    });
    expect((await errs(dto)).some((m) => /nextInvoiceNumber/.test(m))).toBe(
      true,
    );
  });

  // V6: nextInvoiceNumber must be ACCEPTED (not stripped) so the operator
  // can re-align the fiscal counter; the service persists the DTO as-is.
  it("accepts and coerces a valid nextInvoiceNumber", async () => {
    const dto = plainToInstance(UpdateAccountingSettingsDto, {
      nextInvoiceNumber: "42",
    });
    expect(await errs(dto)).toEqual([]);
    expect(dto.nextInvoiceNumber).toBe(42);
  });

  // A7: the seller tax id rides the sellerTaxId snapshot into every issued
  // document — a malformed one only surfaces as a GİB rejection after sync,
  // so it must be shaped like customerTaxId: 10 (VKN) or 11 (TCKN) digits.
  it("accepts a 10-digit VKN and an 11-digit TCKN companyTaxId (A7)", async () => {
    expect(
      await errs(
        plainToInstance(UpdateAccountingSettingsDto, {
          companyTaxId: "1234567890",
        }),
      ),
    ).toEqual([]);
    expect(
      await errs(
        plainToInstance(UpdateAccountingSettingsDto, {
          companyTaxId: "12345678901",
        }),
      ),
    ).toEqual([]);
  });

  it("rejects a companyTaxId that is not 10/11 digits (A7)", async () => {
    for (const bad of ["123", "12345678901234", "12345abcde", "12 34567890"]) {
      const dto = plainToInstance(UpdateAccountingSettingsDto, {
        companyTaxId: bad,
      });
      expect((await errs(dto)).some((m) => /companyTaxId/.test(m))).toBe(true);
    }
  });

  it("lets an empty companyTaxId pass (optional field cleared by a form)", async () => {
    const dto = plainToInstance(UpdateAccountingSettingsDto, {
      companyTaxId: "",
    });
    expect(await errs(dto)).toEqual([]);
    expect(dto.companyTaxId).toBeUndefined();
  });

  // companyTaxId is country-scoped (@IsCountryTaxId) — a UZ tenant's own
  // STIR(9)/PINFL(14) used to be flatly rejected by the fixed VKN/TCKN
  // shape, and its message named Turkey's shapes even under a UZ tenant.
  describe("companyTaxId is country-scoped", () => {
    const errsUnder = (companyTaxId: string, countryCode: string) =>
      RequestContext.run({ countryCode }, () =>
        errs(plainToInstance(UpdateAccountingSettingsDto, { companyTaxId })),
      );

    it("ACCEPTS a 9-digit STIR and a 14-digit PINFL under a UZ tenant", async () => {
      expect(await errsUnder("123456789", "UZ")).toEqual([]);
      expect(await errsUnder("12345678901234", "UZ")).toEqual([]);
    });

    it("rejects the Turkish shapes under a UZ tenant", async () => {
      expect(
        (await errsUnder("1234567890", "UZ")).some((m) =>
          /companyTaxId/.test(m),
        ),
      ).toBe(true);
    });

    it("names the tenant's OWN shapes (STIR/PINFL) in the message, not Turkey's", async () => {
      const msgs = await errsUnder("bad", "UZ");
      expect(msgs.some((m) => /STIR/.test(m) && /PINFL/.test(m))).toBe(true);
    });
  });
});

describe("CreateSalesInvoiceDto", () => {
  it("accepts a 10-digit VKN and an 11-digit TCKN", async () => {
    expect(
      await errs(
        plainToInstance(CreateSalesInvoiceDto, { customerTaxId: "1234567890" }),
      ),
    ).toEqual([]);
    expect(
      await errs(
        plainToInstance(CreateSalesInvoiceDto, { customerTaxId: "12345678901" }),
      ),
    ).toEqual([]);
  });

  it("rejects a tax id that is not 10/11 digits", async () => {
    const dto = plainToInstance(CreateSalesInvoiceDto, {
      customerTaxId: "123",
    });
    expect((await errs(dto)).some((m) => /customerTaxId/.test(m))).toBe(true);
  });

  // customerTaxId is country-scoped (@IsCountryTaxId) — same shape rule as
  // companyTaxId above.
  describe("customerTaxId is country-scoped", () => {
    const errsUnder = (customerTaxId: string, countryCode: string) =>
      RequestContext.run({ countryCode }, () =>
        errs(plainToInstance(CreateSalesInvoiceDto, { customerTaxId })),
      );

    it("ACCEPTS a 9-digit STIR and a 14-digit PINFL under a UZ tenant", async () => {
      expect(await errsUnder("123456789", "UZ")).toEqual([]);
      expect(await errsUnder("12345678901234", "UZ")).toEqual([]);
    });

    it("rejects the Turkish shapes under a UZ tenant", async () => {
      expect(
        (await errsUnder("1234567890", "UZ")).some((m) =>
          /customerTaxId/.test(m),
        ),
      ).toBe(true);
    });
  });

  it("rejects a non-E.164 customerPhone", async () => {
    const dto = plainToInstance(CreateSalesInvoiceDto, {
      customerPhone: "abc",
    });
    expect((await errs(dto)).some((m) => /customerPhone/.test(m))).toBe(true);
  });

  it("accepts a canonical E.164 customerPhone", async () => {
    const dto = plainToInstance(CreateSalesInvoiceDto, {
      customerPhone: "+905551234567",
    });
    expect(await errs(dto)).toEqual([]);
  });

  // T5 sweep: this field never had @NormalizePhone, so it used to accept
  // a bare-digit E.164-shaped string too ("+" optional). The shared
  // E164_PATTERN requires the '+' — the same tightening applied to all 8
  // sites that carried the loose variant.
  it("rejects a bare-digit phone without '+' (loose-to-strict tightening)", async () => {
    const dto = plainToInstance(CreateSalesInvoiceDto, {
      customerPhone: "12345678",
    });
    expect((await errs(dto)).some((m) => /customerPhone/.test(m))).toBe(true);
  });

  it("rejects an invalid customerEmail", async () => {
    const dto = plainToInstance(CreateSalesInvoiceDto, {
      customerEmail: "nope",
    });
    expect((await errs(dto)).some((m) => /customerEmail/.test(m))).toBe(true);
  });
});

describe("InvoiceQueryDto", () => {
  it("coerces page/limit and accepts in-range values", async () => {
    const dto = plainToInstance(InvoiceQueryDto, { page: "2", limit: "50" });
    expect(await errs(dto)).toEqual([]);
    expect(dto.limit).toBe(50);
  });

  it("rejects a limit above the 200 cap (DoS guard)", async () => {
    const dto = plainToInstance(InvoiceQueryDto, { limit: "10000000" });
    expect((await errs(dto)).some((m) => /limit/.test(m))).toBe(true);
  });

  it("caps the search string length", async () => {
    const dto = plainToInstance(InvoiceQueryDto, { search: "x".repeat(201) });
    expect((await errs(dto)).some((m) => /search/.test(m))).toBe(true);
  });
});
