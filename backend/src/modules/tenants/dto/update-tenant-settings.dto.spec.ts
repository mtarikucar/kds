import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateTenantSettingsDto } from './update-tenant-settings.dto';
import { RequestContext } from '../../../common/context/request-context';

/**
 * Iter-45 regressions: tenant-settings DTO must
 *   1. cap reportEmails at 20 (z-report fan-out / SMTP cost vector)
 *   2. reject non-IANA timezones (silent breakage downstream)
 */
describe('UpdateTenantSettingsDto (iter-45)', () => {
  async function validateDto(input: Record<string, unknown>): Promise<string[]> {
    const dto = plainToInstance(UpdateTenantSettingsDto, input) as object;
    const errors = await validate(dto);
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  describe('reportEmails', () => {
    it('accepts a short distribution list', async () => {
      expect(
        await validateDto({ reportEmails: ['a@x.com', 'b@x.com', 'c@x.com'] }),
      ).toEqual([]);
    });

    it('rejects > 20 recipients (spam-amplification guard)', async () => {
      const list = Array.from({ length: 21 }, (_, i) => `u${i}@x.com`);
      const msgs = await validateDto({ reportEmails: list });
      expect(msgs.some((m) => /reportEmails/i.test(m))).toBe(true);
    });

    it('still rejects invalid emails (existing @IsEmail behavior)', async () => {
      const msgs = await validateDto({ reportEmails: ['a@x.com', 'not-an-email'] });
      expect(msgs.length).toBeGreaterThan(0);
    });
  });

  describe('timezone', () => {
    it('accepts a valid IANA timezone', async () => {
      expect(await validateDto({ timezone: 'Europe/Istanbul' })).toEqual([]);
    });

    it('accepts UTC', async () => {
      expect(await validateDto({ timezone: 'UTC' })).toEqual([]);
    });

    it('rejects garbage strings', async () => {
      const msgs = await validateDto({ timezone: 'Not/A/Zone' });
      expect(msgs.some((m) => /timezone/i.test(m))).toBe(true);
    });

    it('rejects path-injection-style values', async () => {
      const msgs = await validateDto({ timezone: '/etc/passwd' });
      expect(msgs.some((m) => /timezone/i.test(m))).toBe(true);
    });

    it('rejects an empty string', async () => {
      const msgs = await validateDto({ timezone: '' });
      expect(msgs.some((m) => /timezone/i.test(m))).toBe(true);
    });
  });

  // taxId is country-scoped (@IsCountryTaxId): before this it was a fixed
  // `/^\d{10,11}$/` (Turkish VKN/TCKN) everywhere, so every Uzbek
  // STIR(9)/PINFL(14) was rejected no matter what was typed.
  describe('taxId (country-scoped)', () => {
    const validateUnder = (taxId: unknown, countryCode: string) =>
      RequestContext.run({ countryCode }, () => validateDto({ taxId }));

    it('accepts a 10-digit VKN and an 11-digit TCKN under a TR tenant', async () => {
      expect(await validateUnder('1234567890', 'TR')).toEqual([]);
      expect(await validateUnder('12345678901', 'TR')).toEqual([]);
    });

    it('rejects the Uzbek shapes under a TR tenant', async () => {
      expect((await validateUnder('123456789', 'TR')).some((m) => /taxId/.test(m))).toBe(
        true,
      );
    });

    it('ACCEPTS a 9-digit STIR and a 14-digit PINFL under a UZ tenant', async () => {
      expect(await validateUnder('123456789', 'UZ')).toEqual([]);
      expect(await validateUnder('12345678901234', 'UZ')).toEqual([]);
    });

    it('rejects the Turkish shapes under a UZ tenant', async () => {
      expect(
        (await validateUnder('1234567890', 'UZ')).some((m) => /taxId/.test(m)),
      ).toBe(true);
    });

    it('falls back to the Turkish shapes outside any request', async () => {
      expect(await validateDto({ taxId: '1234567890' })).toEqual([]);
      expect(
        (await validateDto({ taxId: '123456789' })).some((m) => /taxId/.test(m)),
      ).toBe(true);
    });

    it('still accepts null (clears the stored value) and empty string (unchanged form field)', async () => {
      expect(await validateDto({ taxId: null })).toEqual([]);
      expect(await validateDto({ taxId: '' })).toEqual([]);
    });
  });

  /**
   * Currency is DERIVED from the tenant's country (CountryService /
   * COUNTRY_PROFILES) — see backend/src/common/country/country.service.ts
   * currencyForTenant(). Letting a tenant PATCH `currency` independently of
   * its country would let it disagree with the profile, which is exactly
   * the invariant Task 2 built CountryService to prevent. The DTO carries
   * no decorators for `currency` any more, so Nest's global
   * `ValidationPipe({ whitelist: true })` strips it before it ever reaches
   * the service/Prisma — reproduced here with class-validator's own
   * `whitelist` option, which is the same mechanism the pipe uses.
   */
  describe('currency (no longer writable)', () => {
    it('strips currency — it is derived from country, never user-writable', async () => {
      const dto = plainToInstance(UpdateTenantSettingsDto, {
        currency: 'USD',
      }) as UpdateTenantSettingsDto & { currency?: unknown };
      const errors = await validate(dto, { whitelist: true });
      expect(errors).toEqual([]);
      expect(dto.currency).toBeUndefined();
    });
  });
});
