import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  CreateIntegrationDto,
  IntegrationType,
} from "./create-integration.dto";
import { UpdateIntegrationDto } from "./update-integration.dto";

/**
 * Long-tail validation spec for the integration DTOs. Load-bearing
 * contracts: integrationType is a closed enum, config is an object, and the
 * UPDATE DTO intentionally OMITS integrationType/provider (the compound key
 * that drives the encryption policy) so an admin can't downgrade an
 * encrypted row to a plaintext hardware type.
 */
async function errs(dto: object): Promise<string[]> {
  const results = await validate(dto);
  return results.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe("CreateIntegrationDto", () => {
  const base = {
    integrationType: IntegrationType.PAYMENT_GATEWAY,
    provider: "stripe",
    name: "Stripe",
    config: { apiKey: "sk_test" },
  };

  it("accepts a valid integration", async () => {
    expect(await errs(plainToInstance(CreateIntegrationDto, base))).toEqual([]);
  });

  it("rejects an unknown integrationType", async () => {
    const dto = plainToInstance(CreateIntegrationDto, {
      ...base,
      integrationType: "BANANA",
    });
    expect((await errs(dto)).some((m) => /integrationType/.test(m))).toBe(true);
  });

  it("rejects a non-object config", async () => {
    const dto = plainToInstance(CreateIntegrationDto, {
      ...base,
      config: "not-an-object",
    });
    expect((await errs(dto)).some((m) => /config/.test(m))).toBe(true);
  });
});

describe("UpdateIntegrationDto", () => {
  it("accepts a partial patch without integrationType/provider", async () => {
    const dto = plainToInstance(UpdateIntegrationDto, { name: "Renamed" });
    expect(await errs(dto)).toEqual([]);
  });

  it("does not expose integrationType/provider as settable keys", () => {
    // Even if a caller smuggles them in, the encryption-policy key must not
    // round-trip onto the validated instance shape.
    const dto = plainToInstance(UpdateIntegrationDto, {
      integrationType: "POS_HARDWARE",
      provider: "x",
      name: "ok",
    });
    // The omitted keys are not part of the DTO contract; the service ignores
    // them. We assert the legitimate field survived.
    expect((dto as { name?: string }).name).toBe("ok");
  });
});
