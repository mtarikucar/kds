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

  it("accepts a sandbox environment and a UUID branchId", async () => {
    const dto = plainToInstance(CreatePlatformConfigDto, {
      platform: DeliveryPlatform.GETIR,
      environment: "sandbox",
      branchId: "11111111-1111-4111-8111-111111111111",
    });
    expect(await errs(dto)).toEqual([]);
  });

  it("rejects an unknown environment", async () => {
    const dto = plainToInstance(CreatePlatformConfigDto, {
      platform: DeliveryPlatform.GETIR,
      environment: "staging",
    });
    expect((await errs(dto)).some((m) => /environment/.test(m))).toBe(true);
  });

  it("rejects a non-UUID branchId", async () => {
    const dto = plainToInstance(CreatePlatformConfigDto, {
      platform: DeliveryPlatform.GETIR,
      branchId: "not-a-uuid",
    });
    expect((await errs(dto)).some((m) => /branchId/.test(m))).toBe(true);
  });
});

describe("UpdatePlatformConfigDto", () => {
  it("accepts an empty patch", async () => {
    expect(await errs(plainToInstance(UpdatePlatformConfigDto, {}))).toEqual(
      [],
    );
  });

  it("rejects a non-boolean isEnabled", async () => {
    const dto = plainToInstance(UpdatePlatformConfigDto, { isEnabled: "true" });
    expect((await errs(dto)).some((m) => /isEnabled/.test(m))).toBe(true);
  });

  it("accepts environment + UUID branchId in a patch", async () => {
    const dto = plainToInstance(UpdatePlatformConfigDto, {
      environment: "production",
      branchId: "22222222-2222-4222-8222-222222222222",
    });
    expect(await errs(dto)).toEqual([]);
  });

  it("accepts a null branchId to clear the override", async () => {
    const dto = plainToInstance(UpdatePlatformConfigDto, { branchId: null });
    expect(await errs(dto)).toEqual([]);
  });

  it("rejects a non-UUID branchId", async () => {
    const dto = plainToInstance(UpdatePlatformConfigDto, {
      branchId: "nope",
    });
    expect((await errs(dto)).some((m) => /branchId/.test(m))).toBe(true);
  });
});
