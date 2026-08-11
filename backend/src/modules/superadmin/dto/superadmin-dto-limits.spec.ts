import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SuperAdminLoginDto } from './login.dto';
import { Verify2FADto } from './verify-2fa.dto';
import { SuperAdminRefreshTokenDto } from './refresh-token.dto';
import { LimitOverridesDto } from './update-tenant-overrides.dto';

/**
 * Iter-47 regression: every auth-shaped field on the superadmin API
 * surface must be bounded. This is the HIGHEST-privilege gate in the
 * product — even with the aggressive 5/min throttle the underlying
 * bcryptjs CPU work amplifies under distributed attack.
 */
describe('SuperAdmin DTO length caps (iter-47)', () => {
  async function validateDto(cls: any, input: Record<string, unknown>): Promise<string[]> {
    const dto = plainToInstance(cls, input) as object;
    const errors = await validate(dto);
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  // Faithful to the GLOBAL ValidationPipe (main.ts): transform with
  // enableImplicitConversion + whitelist. A transform regression that only
  // bites under implicit conversion is invisible to the plain validateDto
  // above — exactly the gap that let the discount-date 400 ship twice.
  async function validateDtoProd(
    cls: any,
    input: Record<string, unknown>,
  ): Promise<string[]> {
    const dto = plainToInstance(cls, input, {
      enableImplicitConversion: true,
    }) as object;
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: false,
    });
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  describe('SuperAdminLoginDto', () => {
    const base = { email: 'sa@x.com', password: 'Passw0rd1' };

    it('accepts a normal login', async () => {
      expect(await validateDto(SuperAdminLoginDto, base)).toEqual([]);
    });

    it('rejects password > 128 (bcryptjs CPU-DoS — even on the highest-privilege endpoint)', async () => {
      const msgs = await validateDto(SuperAdminLoginDto, {
        ...base,
        password: 'a'.repeat(129),
      });
      expect(msgs.some((m) => /password/i.test(m))).toBe(true);
    });

    it('rejects oversize emails', async () => {
      const huge = 'a'.repeat(255) + '@x.com';
      const msgs = await validateDto(SuperAdminLoginDto, { ...base, email: huge });
      expect(msgs.length).toBeGreaterThan(0);
    });
  });

  describe('Verify2FADto.tempToken', () => {
    it('rejects tempToken > 4096 chars', async () => {
      const msgs = await validateDto(Verify2FADto, {
        tempToken: 'a'.repeat(4097),
        code: '123456',
      });
      expect(msgs.some((m) => /tempToken/i.test(m))).toBe(true);
    });

    it('accepts a JWT-sized tempToken', async () => {
      // Realistic JWT length is ~500-1000 chars.
      expect(
        await validateDto(Verify2FADto, {
          tempToken: 'a'.repeat(800),
          code: '123456',
        }),
      ).toEqual([]);
    });
  });

  describe('SuperAdminRefreshTokenDto', () => {
    it('rejects refreshToken > 4096 chars', async () => {
      const msgs = await validateDto(SuperAdminRefreshTokenDto, {
        refreshToken: 'a'.repeat(4097),
      });
      expect(msgs.some((m) => /refreshToken/i.test(m))).toBe(true);
    });

    // The refresh token now rides an httpOnly cookie (primary); this body
    // field is an optional backward-compatible fallback, so an empty/omitted
    // value is valid at the DTO layer. The controller enforces "cookie OR
    // body token present" and 401s otherwise. The MaxLength cap — the actual
    // concern of this spec — still applies (see the >4096 case above).
    it('accepts an omitted refreshToken (cookie is the primary source)', async () => {
      expect(await validateDto(SuperAdminRefreshTokenDto, {})).toEqual([]);
    });

    it('accepts an empty refreshToken (optional fallback field)', async () => {
      expect(
        await validateDto(SuperAdminRefreshTokenDto, { refreshToken: '' }),
      ).toEqual([]);
    });

    it('accepts a normal refresh token', async () => {
      expect(
        await validateDto(SuperAdminRefreshTokenDto, { refreshToken: 'a'.repeat(800) }),
      ).toEqual([]);
    });
  });
});

// A per-tenant limit override REPLACES the plan value in the entitlement
// engine. With @Min(0) an override could NEVER express "unlimited" (-1), so a
// 0 override permanently capped a tenant at zero and could not be undone from
// the override form. Overrides must accept -1.
describe('LimitOverridesDto allows -1 (unlimited)', () => {
  async function validateProd(input: Record<string, unknown>): Promise<string[]> {
    const dto = plainToInstance(LimitOverridesDto, input, {
      enableImplicitConversion: true,
    }) as object;
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: false,
    });
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  it('accepts -1 (unlimited) on the branch cap', async () => {
    expect(await validateProd({ maxBranches: -1 })).toEqual([]);
  });

  it('still rejects values below -1', async () => {
    const msgs = await validateProd({ maxBranches: -2 });
    expect(msgs.some((m) => /maxBranches/i.test(m))).toBe(true);
  });

  it('drops a retired cap instead of persisting a number that changes nothing', async () => {
    // maxUsers and friends are granted as -1 by the free baseline and read by
    // no call site since v3.3.0. Under the prod pipe (whitelist: true) the key
    // is stripped, so an operator's value can never reach the DB and sit there
    // looking like an enforced limit.
    const dto = plainToInstance(
      LimitOverridesDto,
      { maxUsers: 5, maxBranches: 3 },
      { enableImplicitConversion: true },
    ) as Record<string, unknown>;
    await validate(dto, { whitelist: true, forbidNonWhitelisted: false });
    expect(dto.maxUsers).toBeUndefined();
    expect(dto.maxBranches).toBe(3);
  });

  it('still accepts a normal positive cap', async () => {
    expect(await validateProd({ maxBranches: 3 })).toEqual([]);
  });
});
