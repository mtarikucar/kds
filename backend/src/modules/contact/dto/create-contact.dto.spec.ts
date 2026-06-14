import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateContactDto } from "./create-contact.dto";

/**
 * Long-tail validation spec for the public contact-form DTO. The
 * SECURITY-load-bearing rule is the NO_CRLF guard on name/email — these
 * fields interpolate into SMTP headers, so a `name = "Foo\r\nBcc: x"` must
 * be rejected to prevent header-injection. Plus the usual format/length
 * caps and the honeypot field.
 */
async function errs(dto: object): Promise<string[]> {
  const results = await validate(dto);
  return results.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe("CreateContactDto", () => {
  const base = {
    name: "John Doe",
    email: "john@example.com",
    message: "I would like more info about your POS.",
  };

  it("accepts a valid submission", async () => {
    expect(await errs(plainToInstance(CreateContactDto, base))).toEqual([]);
  });

  it("rejects a CRLF in the name (SMTP header injection guard)", async () => {
    const dto = plainToInstance(CreateContactDto, {
      ...base,
      name: "Foo\r\nBcc: victim@x.com",
    });
    expect((await errs(dto)).some((m) => /line breaks/.test(m))).toBe(true);
  });

  it("rejects a CRLF in the email", async () => {
    const dto = plainToInstance(CreateContactDto, {
      ...base,
      email: "a@b.com\r\nSubject: spam",
    });
    expect((await errs(dto)).length).toBeGreaterThan(0);
  });

  it("rejects a too-short message", async () => {
    const dto = plainToInstance(CreateContactDto, { ...base, message: "hi" });
    expect((await errs(dto)).some((m) => /message/.test(m))).toBe(true);
  });

  it("rejects a phone with disallowed characters", async () => {
    const dto = plainToInstance(CreateContactDto, {
      ...base,
      phone: "+90 abc",
    });
    expect((await errs(dto)).some((m) => /phone/.test(m))).toBe(true);
  });

  it("accepts a well-formed phone and coerces empty string away", async () => {
    expect(
      await errs(plainToInstance(CreateContactDto, { ...base, phone: "" })),
    ).toEqual([]);
    expect(
      await errs(
        plainToInstance(CreateContactDto, { ...base, phone: "+1 (234) 567-890" }),
      ),
    ).toEqual([]);
  });
});
