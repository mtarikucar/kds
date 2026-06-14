import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdatePosSettingsDto } from "./update-pos-settings.dto";

/**
 * Long-tail validation spec for UpdatePosSettingsDto. All fields are
 * optional booleans except defaultMapView, which is a closed "2d"|"3d"
 * enum. Load-bearing rules: boolean fields reject non-booleans, and
 * defaultMapView rejects values outside the allowed set.
 */
async function errs(dto: object): Promise<string[]> {
  const results = await validate(dto);
  return results.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe("UpdatePosSettingsDto", () => {
  it("accepts an empty patch (all fields optional)", async () => {
    expect(await errs(plainToInstance(UpdatePosSettingsDto, {}))).toEqual([]);
  });

  it("accepts a full valid patch", async () => {
    const dto = plainToInstance(UpdatePosSettingsDto, {
      enableTablelessMode: true,
      enableTwoStepCheckout: false,
      showProductImages: true,
      enableCustomerOrdering: true,
      enableCustomerSelfPay: false,
      defaultMapView: "3d",
      requireServedForDineInPayment: true,
    });
    expect(await errs(dto)).toEqual([]);
  });

  it("rejects a non-boolean flag", async () => {
    const dto = plainToInstance(UpdatePosSettingsDto, {
      enableTablelessMode: "yes",
    });
    expect((await errs(dto)).some((m) => /enableTablelessMode/.test(m))).toBe(
      true,
    );
  });

  it("rejects a defaultMapView outside the 2d/3d set", async () => {
    const dto = plainToInstance(UpdatePosSettingsDto, { defaultMapView: "4d" });
    expect((await errs(dto)).some((m) => /defaultMapView/.test(m))).toBe(true);
  });
});
