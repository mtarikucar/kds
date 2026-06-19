import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { LoginDto } from "./login.dto";
import { RegisterDto } from "./register.dto";
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from "./password-reset.dto";

/**
 * Iter-43 regressions: length caps on every auth DTO that touches a
 * password, email, name, or reset token. The load-bearing assertion
 * is on PASSWORD fields — without @MaxLength(128), bcryptjs would
 * process a megabyte-long submitted password and burn API CPU
 * (bcrypt's internal 72-byte truncation happens AFTER the JS impl
 * iterates the whole input).
 */
describe("Auth DTO length caps (iter-43)", () => {
  async function validateDto(
    cls: any,
    input: Record<string, unknown>,
  ): Promise<string[]> {
    const dto = plainToInstance(cls, input) as object;
    const errors = await validate(dto);
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  describe("LoginDto", () => {
    const base = { email: "u@x.com", password: "Passw0rd!" };
    it("accepts a normal login", async () => {
      expect(await validateDto(LoginDto, base)).toEqual([]);
    });
    it("rejects passwords longer than 128 chars (bcrypt CPU-DoS guard)", async () => {
      const msgs = await validateDto(LoginDto, {
        ...base,
        password: "a".repeat(129),
      });
      expect(msgs.some((m) => /password/i.test(m))).toBe(true);
    });
    it("rejects emails longer than 254 chars (RFC 5321)", async () => {
      // An oversize email fails both @IsEmail (local part > 64) and
      // @MaxLength(254). We only assert SOMETHING failed — the load-
      // bearing guard is the cap, not the order in which validators
      // fire.
      const tooBig = "a".repeat(255) + "@x.com";
      const msgs = await validateDto(LoginDto, { ...base, email: tooBig });
      expect(msgs.length).toBeGreaterThan(0);
    });
  });

  describe("RegisterDto", () => {
    const base = {
      email: "u@x.com",
      password: "Passw0rd1",
      firstName: "X",
      lastName: "Y",
      // phone is now required (PayTR checkout needs it); NormalizePhone("TR")
      // lands a natural TR number as E.164.
      phone: "0555 123 45 67",
      restaurantName: "Z",
    };
    it("accepts a typical registration", async () => {
      expect(await validateDto(RegisterDto, base)).toEqual([]);
    });
    it("requires phone (PayTR checkout needs it)", async () => {
      const { phone, ...noPhone } = base;
      void phone;
      const msgs = await validateDto(RegisterDto, noPhone);
      expect(msgs.some((m) => /phone/i.test(m))).toBe(true);
    });
    it("rejects an unparseable phone with a clear message", async () => {
      const msgs = await validateDto(RegisterDto, { ...base, phone: "abc" });
      expect(msgs.some((m) => /telefon|phone/i.test(m))).toBe(true);
    });
    it("rejects password > 128", async () => {
      const msgs = await validateDto(RegisterDto, {
        ...base,
        password: "Aa1" + "b".repeat(126),
      });
      expect(msgs.some((m) => /password/i.test(m))).toBe(true);
    });
    it("rejects firstName > 100", async () => {
      const msgs = await validateDto(RegisterDto, {
        ...base,
        firstName: "a".repeat(101),
      });
      expect(msgs.some((m) => /firstName/i.test(m))).toBe(true);
    });
    it("rejects restaurantName > 120", async () => {
      const msgs = await validateDto(RegisterDto, {
        ...base,
        restaurantName: "a".repeat(121),
      });
      expect(msgs.some((m) => /restaurantName/i.test(m))).toBe(true);
    });
  });

  describe("Password reset DTOs", () => {
    it("ForgotPasswordDto rejects oversize emails", async () => {
      const huge = "a".repeat(255) + "@x.com";
      const msgs = await validateDto(ForgotPasswordDto, { email: huge });
      expect(msgs.length).toBeGreaterThan(0);
    });

    it("ResetPasswordDto caps both token (256) and newPassword (128)", async () => {
      const longToken = "a".repeat(257);
      const msgs1 = await validateDto(ResetPasswordDto, {
        token: longToken,
        newPassword: "Passw0rd1",
      });
      expect(msgs1.some((m) => /token/i.test(m))).toBe(true);

      const msgs2 = await validateDto(ResetPasswordDto, {
        token: "abc",
        newPassword: "Aa1" + "b".repeat(126),
      });
      expect(msgs2.some((m) => /password/i.test(m))).toBe(true);
    });

    it("ChangePasswordDto caps currentPassword (bcrypt.compare also CPU-bound)", async () => {
      // The currentPassword guard is the load-bearing one — bcrypt.compare
      // runs the same hash work on the submitted side as bcrypt.hash, so
      // a megabyte currentPassword is a CPU-DoS vector even though it
      // would never match a real hash.
      const msgs = await validateDto(ChangePasswordDto, {
        currentPassword: "a".repeat(129),
        newPassword: "Passw0rd1",
      });
      expect(msgs.some((m) => /currentPassword/i.test(m))).toBe(true);
    });
  });
});
