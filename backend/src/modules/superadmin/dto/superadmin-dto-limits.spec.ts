import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SuperAdminLoginDto } from './login.dto';
import { Verify2FADto } from './verify-2fa.dto';
import { SuperAdminRefreshTokenDto } from './refresh-token.dto';

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

    it('rejects empty refreshToken', async () => {
      const msgs = await validateDto(SuperAdminRefreshTokenDto, { refreshToken: '' });
      expect(msgs.length).toBeGreaterThan(0);
    });

    it('accepts a normal refresh token', async () => {
      expect(
        await validateDto(SuperAdminRefreshTokenDto, { refreshToken: 'a'.repeat(800) }),
      ).toEqual([]);
    });
  });
});
