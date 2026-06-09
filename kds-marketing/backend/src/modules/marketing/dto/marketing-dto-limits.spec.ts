import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MarketingLoginDto } from './login.dto';
import { RefreshTokenDto } from './refresh-token.dto';
import {
  CreateMarketingUserDto,
  MarketingUserRole,
} from './create-marketing-user.dto';
import { UpdateProfileDto } from './update-profile.dto';

/**
 * Iter-49 regression: marketing is the third auth realm in the
 * codebase (after tenant + superadmin). Same bcryptjs CPU-DoS surface
 * iter-43 / iter-46 / iter-47 closed elsewhere — replicate here.
 */
describe('Marketing DTO length caps (iter-49)', () => {
  async function validateDto(cls: any, input: Record<string, unknown>): Promise<string[]> {
    const dto = plainToInstance(cls, input) as object;
    const errors = await validate(dto);
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  describe('MarketingLoginDto', () => {
    const base = { email: 'rep@example.com', password: 'Pass1234' };

    it('accepts a normal login', async () => {
      expect(await validateDto(MarketingLoginDto, base)).toEqual([]);
    });

    it('rejects password > 128 (bcryptjs DoS — third auth realm)', async () => {
      const msgs = await validateDto(MarketingLoginDto, {
        ...base,
        password: 'a'.repeat(129),
      });
      expect(msgs.length).toBeGreaterThan(0);
    });

    it('rejects oversize emails', async () => {
      const msgs = await validateDto(MarketingLoginDto, {
        ...base,
        email: 'a'.repeat(255) + '@x.com',
      });
      expect(msgs.length).toBeGreaterThan(0);
    });
  });

  describe('RefreshTokenDto', () => {
    it('rejects refreshToken > 4096 chars', async () => {
      const msgs = await validateDto(RefreshTokenDto, {
        refreshToken: 'a'.repeat(4097),
      });
      expect(msgs.length).toBeGreaterThan(0);
    });

    it('accepts a normal JWT-sized token', async () => {
      expect(
        await validateDto(RefreshTokenDto, { refreshToken: 'a'.repeat(800) }),
      ).toEqual([]);
    });
  });

  describe('CreateMarketingUserDto', () => {
    const base = {
      email: 'rep@example.com',
      password: 'Passw0rd1',
      firstName: 'Alice',
      lastName: 'Rep',
      role: MarketingUserRole.SALES_REP,
    };

    it('accepts a typical create', async () => {
      expect(await validateDto(CreateMarketingUserDto, base)).toEqual([]);
    });

    it('rejects password > 128', async () => {
      const msgs = await validateDto(CreateMarketingUserDto, {
        ...base,
        password: 'Aa1' + 'b'.repeat(126),
      });
      expect(msgs.length).toBeGreaterThan(0);
    });

    it('rejects oversize firstName', async () => {
      const msgs = await validateDto(CreateMarketingUserDto, {
        ...base,
        firstName: 'a'.repeat(101),
      });
      expect(msgs.length).toBeGreaterThan(0);
    });

    it('rejects malformed phone (regex)', async () => {
      const msgs = await validateDto(CreateMarketingUserDto, {
        ...base,
        phone: 'not-a-phone',
      });
      expect(msgs.length).toBeGreaterThan(0);
    });

    it('accepts E.164 phone', async () => {
      expect(
        await validateDto(CreateMarketingUserDto, {
          ...base,
          phone: '+905551234567',
        }),
      ).toEqual([]);
    });
  });

  describe('UpdateProfileDto', () => {
    it('rejects firstName > 100', async () => {
      const msgs = await validateDto(UpdateProfileDto, {
        firstName: 'a'.repeat(101),
      });
      expect(msgs.length).toBeGreaterThan(0);
    });

    it('rejects garbage phone (newly-validated regex)', async () => {
      const msgs = await validateDto(UpdateProfileDto, { phone: 'abc' });
      expect(msgs.length).toBeGreaterThan(0);
    });
  });
});
