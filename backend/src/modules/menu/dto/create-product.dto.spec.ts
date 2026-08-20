import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { CreateProductDto } from "./create-product.dto";
import { RequestContext } from "../../../common/context/request-context";

/**
 * Product taxRate is validated against the AMBIENT tenant's country, not a
 * fixed [0, 1, 10, 20] band — before this, Uzbekistan's 12% QQS and 6%
 * catering rate could not be entered at all. TR behaviour must stay
 * bit-identical (same accepted set, same default, same rejection of
 * out-of-band values) since that is the fallback everywhere.
 */
// A real UUID — categoryId is @IsUUID(), so a placeholder like "c1" would
// fail validation for an unrelated reason and mask what these tests exist
// to pin (the taxRate band).
const CATEGORY_ID = "550e8400-e29b-41d4-a716-446655440000";

const make = (taxRate: number) =>
  plainToInstance(CreateProductDto, {
    name: "X",
    price: 10,
    categoryId: CATEGORY_ID,
    taxRate,
  });

const errorsFor = async (taxRate: number, countryCode: string) =>
  RequestContext.run({ countryCode }, () => validate(make(taxRate)));

describe("CreateProductDto taxRate is country-scoped", () => {
  it("accepts every Turkish band under a TR tenant", async () => {
    for (const r of [0, 1, 10, 20]) {
      expect(await errorsFor(r, "TR")).toHaveLength(0);
    }
  });

  it("rejects 12 under a TR tenant", async () => {
    expect((await errorsFor(12, "TR")).length).toBeGreaterThan(0);
  });

  it("ACCEPTS 12 under a UZ tenant — the QQS rate that was impossible before", async () => {
    expect(await errorsFor(12, "UZ")).toHaveLength(0);
  });

  it("accepts the UZ catering rate of 6", async () => {
    expect(await errorsFor(6, "UZ")).toHaveLength(0);
  });

  it("rejects 20 under a UZ tenant — Turkey's rate is not Uzbekistan's", async () => {
    expect((await errorsFor(20, "UZ")).length).toBeGreaterThan(0);
  });

  it("falls back to the Turkish bands outside any request", async () => {
    // Cron, seeds, bootstrap. Must not start rejecting everything.
    expect(await validate(make(20))).toHaveLength(0);
    expect((await validate(make(12))).length).toBeGreaterThan(0);
  });

  it("still rejects a value that is not even a number", async () => {
    const errors = await RequestContext.run({ countryCode: "TR" }, () =>
      validate(make("ten" as unknown as number)),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("names the tenant's OWN rates in the rejection message, not Turkey's", async () => {
    const errors = await errorsFor(20, "UZ");
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    expect(messages.some((m) => /0, 6, 12/.test(m))).toBe(true);
  });
});
