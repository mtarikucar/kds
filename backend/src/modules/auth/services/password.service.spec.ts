import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PasswordService } from './password.service';

/**
 * Direct spec for PasswordService (the credential seam behind AuthService):
 *  - bcryptCost: env-tunable within [10,15], else default 12
 *  - validateUser: timing-normalized null on unknown user / bad password,
 *    and the account/tenant-status UnauthorizedExceptions on a good password
 *  - forgotPassword: same enumeration-safe message whether or not the user exists
 *  - changePassword: NotFound / wrong-current-password guards
 */
function makePrisma() {
  return {
    user: { findUnique: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
    userActivity: { create: jest.fn().mockResolvedValue({}) },
    refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $transaction: jest.fn().mockResolvedValue([{ count: 1 }]),
  };
}
function makeConfig(map: Record<string, string | undefined> = {}) {
  return { get: (k: string) => map[k] } as any;
}
const email = { sendPasswordResetEmail: jest.fn().mockResolvedValue(true) } as any;

describe('PasswordService.bcryptCost', () => {
  it('defaults to 12 when BCRYPT_COST is unset', () => {
    const svc = new PasswordService(makePrisma() as any, makeConfig(), email);
    expect(svc.bcryptCost()).toBe(12);
  });

  it('honors an in-range BCRYPT_COST env value', () => {
    const svc = new PasswordService(makePrisma() as any, makeConfig({ BCRYPT_COST: '13' }), email);
    expect(svc.bcryptCost()).toBe(13);
  });

  it('clamps an out-of-range value back to the default', () => {
    const svc = new PasswordService(makePrisma() as any, makeConfig({ BCRYPT_COST: '99' }), email);
    expect(svc.bcryptCost()).toBe(12);
  });

  it('ignores a non-numeric value', () => {
    const svc = new PasswordService(makePrisma() as any, makeConfig({ BCRYPT_COST: 'abc' }), email);
    expect(svc.bcryptCost()).toBe(12);
  });
});

describe('PasswordService.validateUser', () => {
  const goodHash = bcrypt.hashSync('correct-horse', 4);

  function userRow(over: Record<string, unknown> = {}) {
    return {
      id: 'u1',
      email: 'u@test.com',
      password: goodHash,
      firstName: 'A',
      lastName: 'B',
      role: 'ADMIN',
      status: 'ACTIVE',
      tenantId: 't1',
      tenant: { status: 'ACTIVE' },
      ...over,
    };
  }

  it('returns null for an unknown user (no throw, enumeration-safe)', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue(null);
    const svc = new PasswordService(prisma as any, makeConfig(), email);
    await expect(svc.validateUser('ghost@test.com', 'x')).resolves.toBeNull();
  });

  it('returns null on a bad password', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue(userRow());
    const svc = new PasswordService(prisma as any, makeConfig(), email);
    await expect(svc.validateUser('u@test.com', 'wrong')).resolves.toBeNull();
  });

  it('returns the sanitized user (no password/tenant) on success', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue(userRow());
    const svc = new PasswordService(prisma as any, makeConfig(), email);
    const res = await svc.validateUser('u@test.com', 'correct-horse');
    expect(res).toMatchObject({ id: 'u1', role: 'ADMIN' });
    expect(res).not.toHaveProperty('password');
    expect(res).not.toHaveProperty('tenant');
  });

  it('throws on a PENDING_APPROVAL account (after correct password)', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue(userRow({ status: 'PENDING_APPROVAL' }));
    const svc = new PasswordService(prisma as any, makeConfig(), email);
    await expect(svc.validateUser('u@test.com', 'correct-horse')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws when the tenant is not ACTIVE', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue(userRow({ tenant: { status: 'SUSPENDED' } }));
    const svc = new PasswordService(prisma as any, makeConfig(), email);
    await expect(svc.validateUser('u@test.com', 'correct-horse')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('PasswordService.forgotPassword', () => {
  it('returns the generic message and does NOT email when the user is unknown', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue(null);
    const svc = new PasswordService(prisma as any, makeConfig(), email);
    const res = await svc.forgotPassword({ email: 'ghost@test.com' } as any);
    expect(res.message).toMatch(/if an account/i);
    expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('emails a reset token and returns the same generic message for a known user', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'u@test.com' });
    prisma.user.update.mockResolvedValue({});
    const localEmail = { sendPasswordResetEmail: jest.fn().mockResolvedValue(true) } as any;
    const svc = new PasswordService(prisma as any, makeConfig(), localEmail);
    const res = await svc.forgotPassword({ email: 'u@test.com' } as any);
    expect(res.message).toMatch(/if an account/i);
    expect(localEmail.sendPasswordResetEmail).toHaveBeenCalledWith('u@test.com', expect.any(String));
    // stored value is the HASH, not the raw token that was emailed
    const stored = prisma.user.update.mock.calls[0][0].data.resetTokenHash;
    const emailedRaw = localEmail.sendPasswordResetEmail.mock.calls[0][1];
    expect(stored).not.toBe(emailedRaw);
  });
});

describe('PasswordService.changePassword', () => {
  it('throws NotFound when the user does not exist', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue(null);
    const svc = new PasswordService(prisma as any, makeConfig(), email);
    await expect(
      svc.changePassword('u1', { currentPassword: 'x', newPassword: 'y' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadRequest when the current password is wrong', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      tenantId: 't1',
      password: bcrypt.hashSync('real', 4),
    });
    const svc = new PasswordService(prisma as any, makeConfig(), email);
    await expect(
      svc.changePassword('u1', { currentPassword: 'wrong', newPassword: 'new' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
