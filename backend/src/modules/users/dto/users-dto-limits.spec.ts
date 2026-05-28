import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto } from './create-user.dto';
import { UpdateUserDto } from './update-user.dto';
import { UpdateEmailDto, UpdateProfileDto } from './update-profile.dto';
import { UserRole } from '../../../common/constants/roles.enum';

/**
 * Iter-46 regression: extend iter-43's bcryptjs CPU-DoS / persisted-
 * column hygiene caps to every users-module DTO. The load-bearing
 * fields are passwords (bcrypt.hash and bcrypt.compare run the same
 * CPU work on the submitted side); emails and names are caps to keep
 * persisted-column hygiene consistent.
 */
describe('Users DTO length caps (iter-46)', () => {
  async function validateDto(cls: any, input: Record<string, unknown>): Promise<string[]> {
    const dto = plainToInstance(cls, input) as object;
    const errors = await validate(dto);
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  describe('CreateUserDto', () => {
    const base = {
      email: 'u@x.com',
      password: 'Passw0rd1',
      firstName: 'A',
      lastName: 'B',
      role: UserRole.WAITER,
    };
    it('accepts a typical create', async () => {
      expect(await validateDto(CreateUserDto, base)).toEqual([]);
    });
    it('rejects password > 128 (bcryptjs CPU-DoS guard)', async () => {
      const msgs = await validateDto(CreateUserDto, {
        ...base,
        password: 'Aa1' + 'b'.repeat(126),
      });
      expect(msgs.some((m) => /password/i.test(m))).toBe(true);
    });
    it('rejects firstName > 100', async () => {
      const msgs = await validateDto(CreateUserDto, { ...base, firstName: 'a'.repeat(101) });
      expect(msgs.some((m) => /firstName/i.test(m))).toBe(true);
    });
  });

  describe('UpdateUserDto', () => {
    it('rejects password > 128', async () => {
      const msgs = await validateDto(UpdateUserDto, {
        password: 'Aa1' + 'b'.repeat(126),
      });
      expect(msgs.some((m) => /password/i.test(m))).toBe(true);
    });
    it('still accepts partial updates (existing optional behavior)', async () => {
      expect(await validateDto(UpdateUserDto, { firstName: 'New' })).toEqual([]);
    });
  });

  describe('UpdateProfileDto', () => {
    it('rejects phone > 20 chars', async () => {
      const msgs = await validateDto(UpdateProfileDto, { phone: '+9' + '0'.repeat(30) });
      expect(msgs.some((m) => /phone/i.test(m))).toBe(true);
    });
    it('rejects firstName > 100 chars', async () => {
      const msgs = await validateDto(UpdateProfileDto, { firstName: 'a'.repeat(101) });
      expect(msgs.some((m) => /firstName/i.test(m))).toBe(true);
    });
  });

  describe('UpdateEmailDto', () => {
    it('rejects currentPassword > 128 (bcrypt.compare CPU-DoS — iter-43 pattern)', async () => {
      // The load-bearing test: currentPassword goes through
      // bcrypt.compare which runs the same CPU work as bcrypt.hash
      // on the submitted side. Without this cap, the email-change
      // endpoint becomes a CPU-DoS vector.
      const msgs = await validateDto(UpdateEmailDto, {
        email: 'new@x.com',
        currentPassword: 'a'.repeat(129),
      });
      expect(msgs.some((m) => /currentPassword/i.test(m))).toBe(true);
    });

    it('accepts a normal email change request', async () => {
      expect(
        await validateDto(UpdateEmailDto, {
          email: 'new@x.com',
          currentPassword: 'Passw0rd1',
        }),
      ).toEqual([]);
    });
  });
});
