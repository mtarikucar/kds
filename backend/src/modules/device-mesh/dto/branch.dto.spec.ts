import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBranchDto, UpdateBranchDto } from './branch.dto';

/**
 * Iter-73 regression — branches controller previously took inline @Body()
 * types so ValidationPipe couldn't fire. The DTOs added in iter-73 must
 * actually validate the fields, and the IANA timezone gate has to
 * reject typos (otherwise the per-branch midnight computation in
 * health-dashboard / z-reports / attendance silently breaks).
 */
describe('Branch DTOs (iter-73)', () => {
  async function errors(dto: object): Promise<string[]> {
    const results = await validate(dto);
    return results.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  describe('CreateBranchDto', () => {
    it('accepts an empty payload (every field optional, defaults filled by service)', async () => {
      expect(await errors(plainToInstance(CreateBranchDto, {}))).toEqual([]);
    });

    it('accepts a realistic chain branch', async () => {
      const dto = plainToInstance(CreateBranchDto, {
        name: 'Bağdat Caddesi',
        code: 'IST-01',
        timezone: 'Europe/Istanbul',
        address: { street: 'Bağdat Cd. 100', district: 'Kadıköy' },
      });
      expect(await errors(dto)).toEqual([]);
    });

    it('rejects a typo timezone (the load-bearing iter-45-pattern gate)', async () => {
      const dto = plainToInstance(CreateBranchDto, { timezone: 'Eüropa/Istanbul' });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /timezone/i.test(m))).toBe(true);
    });

    it('rejects empty-string timezone', async () => {
      const dto = plainToInstance(CreateBranchDto, { timezone: '' });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /timezone/i.test(m))).toBe(true);
    });

    it('rejects oversize name', async () => {
      const dto = plainToInstance(CreateBranchDto, { name: 'x'.repeat(101) });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /name/i.test(m))).toBe(true);
    });

    it('rejects oversize code', async () => {
      const dto = plainToInstance(CreateBranchDto, { code: 'x'.repeat(33) });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /code/i.test(m))).toBe(true);
    });

    it('rejects non-object address (JSONB shape guard)', async () => {
      const dto = plainToInstance(CreateBranchDto, { address: 'plain string' as any });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /address/i.test(m))).toBe(true);
    });
  });

  describe('UpdateBranchDto', () => {
    it('accepts an enum-valid status', async () => {
      const dto = plainToInstance(UpdateBranchDto, { status: 'suspended' });
      expect(await errors(dto)).toEqual([]);
    });

    it('rejects an enum-invalid status (the iter-73 allowlist replaces the service-side includes() check)', async () => {
      const dto = plainToInstance(UpdateBranchDto, { status: 'whatever' });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /status/i.test(m))).toBe(true);
    });
  });
});
