import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreatePlatformConfigDto } from "./create-platform-config.dto";
import { UpdatePlatformConfigDto } from "./update-platform-config.dto";
import { DeliveryPlatform } from "../constants/platform.enum";

/**
 * Long-tail validation spec for the delivery-platform config DTOs. Load-
 * bearing rules: create requires a platform from the closed enum;
 * credentials must be an object (not a smuggled string); update is a
 * partial patch.
 */
async function errs(dto: object): Promise<string[]> {
  const results = await validate(dto);
  return results.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe("CreatePlatformConfigDto", () => {
  it("accepts a valid config", async () => {
    const dto = plainToInstance(CreatePlatformConfigDto, {
      platform: DeliveryPlatform.GETIR,
      credentials: { apiKey: "x" },
      autoAccept: true,
    });
    expect(await errs(dto)).toEqual([]);
  });

  it("rejects an unknown platform", async () => {
    const dto = plainToInstance(CreatePlatformConfigDto, {
      platform: "UBEREATS",
    });
    expect((await errs(dto)).some((m) => /platform/.test(m))).toBe(true);
  });

  it("rejects non-object credentials", async () => {
    const dto = plainToInstance(CreatePlatformConfigDto, {
      platform: DeliveryPlatform.GETIR,
      credentials: "apiKey=x",
    });
    expect((await errs(dto)).some((m) => /credentials/.test(m))).toBe(true);
  });
});

describe("UpdatePlatformConfigDto", () => {
  it("accepts an empty patch", async () => {
    expect(await errs(plainToInstance(UpdatePlatformConfigDto, {}))).toEqual([]);
  });

  it("rejects a non-boolean isEnabled", async () => {
    const dto = plainToInstance(UpdatePlatformConfigDto, { isEnabled: "true" });
    expect((await errs(dto)).some((m) => /isEnabled/.test(m))).toBe(true);
  });
});
