import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { MenuImportProductDraftDto } from "./menu-import.dto";
import { RequestContext } from "../../../common/context/request-context";

/**
 * The bulk/AI-import draft DTO carries the SAME taxRate band as
 * CreateProductDto (menu-tabular-mapper.ts / menu-import.service.ts build
 * these rows from a CSV/XLSX or a digitised photo before commit). It must
 * be exactly as country-scoped, or a UZ operator importing a spreadsheet
 * with a 12% QQS column would have every row rejected at /commit even
 * though direct product entry now accepts it.
 */
const make = (taxRate: number) =>
  plainToInstance(MenuImportProductDraftDto, {
    name: "Adana Kebap",
    price: 180,
    taxRate,
  });

const errorsFor = async (taxRate: number, countryCode: string) =>
  RequestContext.run({ countryCode }, () => validate(make(taxRate)));

describe("MenuImportProductDraftDto taxRate is country-scoped", () => {
  it("accepts the Turkish bands under a TR tenant", async () => {
    for (const r of [0, 1, 10, 20]) {
      expect(await errorsFor(r, "TR")).toHaveLength(0);
    }
  });

  it("ACCEPTS 12 (QQS) under a UZ tenant", async () => {
    expect(await errorsFor(12, "UZ")).toHaveLength(0);
  });

  it("accepts 6 (UZ catering rate)", async () => {
    expect(await errorsFor(6, "UZ")).toHaveLength(0);
  });

  it("rejects Turkey's 20 under a UZ tenant", async () => {
    expect((await errorsFor(20, "UZ")).length).toBeGreaterThan(0);
  });

  it("falls back to the Turkish bands outside any request", async () => {
    expect(await validate(make(20))).toHaveLength(0);
    expect((await validate(make(12))).length).toBeGreaterThan(0);
  });
});
