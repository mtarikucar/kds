import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SuperAdminLoginDto } from './login.dto';
import { Verify2FADto } from './verify-2fa.dto';
import { SuperAdminRefreshTokenDto } from './refresh-token.dto';
import { CreatePlanDto, UpdatePlanDto } from './subscription-filter.dto';
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

  // Regression: the superadmin Plans form sends EVERY field on save,
  // including discountStartDate/discountEndDate as '' (empty string) when no
  // discount is configured. @IsOptional() only skips undefined/null, so a
  // bare @IsDateString() rejected '' with a 400 and blocked ALL plan edits.
  // The DTO now coerces '' -> undefined for these optional date fields.
  describe('CreatePlanDto discount dates', () => {
    const base = {
      name: 'pro',
      displayName: 'Pro',
      monthlyPrice: 100,
      yearlyPrice: 1000,
    };

    it('accepts empty-string discount dates (coerced to undefined)', async () => {
      const msgs = await validateDto(CreatePlanDto, {
        ...base,
        discountStartDate: '',
        discountEndDate: '',
      });
      expect(msgs).toEqual([]);
    });

    it('accepts empty-string discount dates on UpdatePlanDto (PATCH)', async () => {
      const msgs = await validateDto(UpdatePlanDto, {
        discountStartDate: '',
        discountEndDate: '',
      });
      expect(msgs).toEqual([]);
    });

    it('accepts a real ISO discount date', async () => {
      const msgs = await validateDto(CreatePlanDto, {
        ...base,
        discountStartDate: '2026-06-16',
        discountEndDate: '2026-07-16',
      });
      expect(msgs).toEqual([]);
    });

    it('still rejects a non-date, non-empty discount date', async () => {
      const msgs = await validateDto(CreatePlanDto, {
        ...base,
        discountStartDate: 'not-a-date',
      });
      expect(msgs.some((m) => /discountStartDate/i.test(m))).toBe(true);
    });
  });

  // Same cases but through the GLOBAL ValidationPipe's transformOptions
  // (enableImplicitConversion). This is what actually runs in prod; the
  // plain plainToInstance path can mask an implicit-conversion-only bug.
  describe('discount dates under prod ValidationPipe options', () => {
    const fullForm = {
      name: 'pro',
      displayName: 'Pro',
      description: '',
      monthlyPrice: 100,
      yearlyPrice: 1000,
      currency: 'TRY',
      maxUsers: 1,
      maxTables: 5,
      maxProducts: 50,
      maxCategories: 10,
      maxMonthlyOrders: 100,
      advancedReports: false,
      kdsIntegration: true,
      isActive: true,
      discountPercentage: 0,
      discountLabel: '',
      discountStartDate: '',
      discountEndDate: '',
      isDiscountActive: false,
    };

    it('accepts the full create form payload with blank dates', async () => {
      expect(await validateDtoProd(CreatePlanDto, fullForm)).toEqual([]);
    });

    it('accepts the full update (PATCH) form payload with blank dates', async () => {
      expect(await validateDtoProd(UpdatePlanDto, fullForm)).toEqual([]);
    });

    it('accepts omitted discount dates on PATCH', async () => {
      expect(
        await validateDtoProd(UpdatePlanDto, { monthlyPrice: 200 }),
      ).toEqual([]);
    });

    it('accepts real ISO discount dates', async () => {
      expect(
        await validateDtoProd(UpdatePlanDto, {
          discountStartDate: '2026-06-16',
          discountEndDate: '2026-07-16',
          isDiscountActive: true,
        }),
      ).toEqual([]);
    });

    it('still rejects a genuinely malformed discount date', async () => {
      const msgs = await validateDtoProd(CreatePlanDto, {
        ...fullForm,
        discountStartDate: '16/06/2026',
      });
      expect(msgs.some((m) => /discountStartDate/i.test(m))).toBe(true);
    });
  });
});

// Regression: the superadmin Plans form resends EVERY field on save. When a
// limit input is cleared it arrives as '' (empty string). Under the global
// ValidationPipe (transform + enableImplicitConversion) a bare
// @Type(() => Number) coerces '' through Number('') -> 0, which sails past
// @Min(-1) and PERSISTS 0. For a BUSINESS plan whose limits are -1
// (unlimited), this silently rewrites "unlimited" to "zero allowed" — the
// dashboard then shows "X / 0" and PlanFeatureGuard blocks every create
// (currentCount >= 0 is always true). The fix (@Type(() => String) +
// @EmptyStringToNumber) makes '' coerce to undefined so @IsOptional() skips it
// and Prisma leaves the column untouched on PATCH.
describe('Plan limit fields: blank must not become 0 (unlimited regression)', () => {
  // Faithful to the GLOBAL ValidationPipe (main.ts): transform with
  // enableImplicitConversion. Returns the TRANSFORMED instance so we can
  // assert the coerced value, not just validation messages.
  function transformProd<T>(
    cls: new () => T,
    input: Record<string, unknown>,
  ): T {
    return plainToInstance(cls, input, {
      enableImplicitConversion: true,
    }) as T;
  }

  async function validateProd(
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

  const LIMIT_FIELDS = [
    'maxUsers',
    'maxTables',
    'maxBranches',
    'maxProducts',
    'maxCategories',
    'maxMonthlyOrders',
  ] as const;

  describe('CreatePlanDto', () => {
    const base = {
      name: 'biz',
      displayName: 'Business',
      monthlyPrice: 2999,
      yearlyPrice: 29990,
    };

    for (const field of LIMIT_FIELDS) {
      it(`coerces blank ${field} to undefined (NOT 0)`, () => {
        const dto = transformProd(CreatePlanDto, { ...base, [field]: '' });
        expect((dto as Record<string, unknown>)[field]).toBeUndefined();
      });
    }

    it('preserves -1 (unlimited) for every limit', () => {
      const dto = transformProd(CreatePlanDto, {
        ...base,
        maxUsers: -1,
        maxTables: -1,
        maxBranches: -1,
        maxProducts: -1,
        maxCategories: -1,
        maxMonthlyOrders: -1,
      });
      for (const field of LIMIT_FIELDS) {
        expect((dto as Record<string, unknown>)[field]).toBe(-1);
      }
    });

    it('parses a real numeric string into a number', () => {
      const dto = transformProd(CreatePlanDto, { ...base, maxUsers: '5' });
      expect(dto.maxUsers).toBe(5);
    });

    it('exposes maxBranches and accepts -1 / a real value', async () => {
      expect(
        await validateProd(CreatePlanDto, { ...base, maxBranches: -1 }),
      ).toEqual([]);
      expect(
        await validateProd(CreatePlanDto, { ...base, maxBranches: 3 }),
      ).toEqual([]);
      const msgs = await validateProd(CreatePlanDto, {
        ...base,
        maxBranches: -2,
      });
      expect(msgs.some((m) => /maxBranches/i.test(m))).toBe(true);
    });
  });

  describe('UpdatePlanDto (PATCH — touching only price must not zero limits)', () => {
    it('coerces every blank limit to undefined so the column is left untouched', () => {
      const dto = transformProd(UpdatePlanDto, {
        monthlyPrice: 3499,
        maxUsers: '',
        maxTables: '',
        maxBranches: '',
        maxProducts: '',
        maxCategories: '',
        maxMonthlyOrders: '',
      });
      for (const field of LIMIT_FIELDS) {
        expect((dto as Record<string, unknown>)[field]).toBeUndefined();
      }
    });
  });
});

// A per-tenant limit override REPLACES the plan value in the entitlement
// engine. With @Min(0) an override could NEVER express "unlimited" (-1), so a
// 0 override permanently capped a BUSINESS tenant at zero and could not be
// undone from the override form. Overrides must accept -1.
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

  it('accepts -1 on every limit override', async () => {
    expect(
      await validateProd({
        maxUsers: -1,
        maxTables: -1,
        maxBranches: -1,
        maxProducts: -1,
        maxCategories: -1,
        maxMonthlyOrders: -1,
      }),
    ).toEqual([]);
  });

  it('still rejects values below -1', async () => {
    const msgs = await validateProd({ maxUsers: -2 });
    expect(msgs.some((m) => /maxUsers/i.test(m))).toBe(true);
  });

  it('still accepts a normal positive cap', async () => {
    expect(await validateProd({ maxBranches: 3 })).toEqual([]);
  });
});
