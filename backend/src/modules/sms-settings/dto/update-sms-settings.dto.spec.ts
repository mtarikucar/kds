import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdateSmsSettingsDto } from "./update-sms-settings.dto";

/**
 * Long-tail validation spec for UpdateSmsSettingsDto. Every field is an
 * optional boolean per-event toggle. Load-bearing: a non-boolean is
 * rejected (so a typo'd "1"/"on" can't silently disable a channel), and an
 * empty patch is accepted.
 */
async function errs(dto: object): Promise<string[]> {
  const results = await validate(dto);
  return results.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe("UpdateSmsSettingsDto", () => {
  it("accepts an empty patch", async () => {
    expect(await errs(plainToInstance(UpdateSmsSettingsDto, {}))).toEqual([]);
  });

  it("accepts a mix of sms + email per-event toggles", async () => {
    const dto = plainToInstance(UpdateSmsSettingsDto, {
      isEnabled: true,
      smsOnReservationCreated: false,
      emailOnReservationConfirmed: true,
      smsOnOrderReady: true,
    });
    expect(await errs(dto)).toEqual([]);
  });

  it("rejects a non-boolean toggle", async () => {
    const dto = plainToInstance(UpdateSmsSettingsDto, {
      smsOnOrderReady: "yes",
    });
    expect((await errs(dto)).some((m) => /smsOnOrderReady/.test(m))).toBe(true);
  });
});
