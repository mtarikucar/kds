import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdateProfileDto } from "./update-profile.dto";

// Mirrors the app's ValidationPipe (transform: true): plainToInstance runs the
// @NormalizePhone transform, then class-validator runs @Matches on the result.
async function run(payload: Record<string, unknown>) {
  const dto = plainToInstance(UpdateProfileDto, payload);
  const errors = await validate(dto);
  return { dto, errors };
}

describe("UpdateProfileDto.phone (normalize + validate)", () => {
  it.each([
    "0555 123 45 67",
    "+90 555 123 45 67",
    "05551234567",
    "(0555) 123-45-67",
    "+905551234567",
  ])("accepts the natural format %p and normalizes to +905551234567", async (phone) => {
    const { dto, errors } = await run({ phone });
    expect(errors).toHaveLength(0);
    expect(dto.phone).toBe("+905551234567");
  });

  it("treats an empty phone as omitted (optional)", async () => {
    const { dto, errors } = await run({ phone: "   " });
    expect(errors).toHaveLength(0);
    expect(dto.phone).toBeUndefined();
  });

  it("rejects an unparseable value with the friendly message", async () => {
    const { errors } = await run({ phone: "not-a-phone" });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints?.matches).toBe(
      "Lütfen geçerli bir telefon numarası girin.",
    );
  });
});
