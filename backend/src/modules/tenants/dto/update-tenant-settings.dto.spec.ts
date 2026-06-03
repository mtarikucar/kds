import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateTenantSettingsDto } from './update-tenant-settings.dto';

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
});
