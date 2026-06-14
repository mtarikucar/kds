import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { EmailVerificationService } from './email-verification.service';

/**
 * Direct spec for EmailVerificationService — the 6-digit code lifecycle:
 *  - send: NotFound for unknown user; short-circuit when already verified;
 *    otherwise stores the code HASH (not raw) and emails the raw code
 *  - verify: enumeration-safe BadRequest on unknown user / expired / bad code;
 *    success on a matching, unexpired code via the atomic single-use claim;
 *    BadRequest when the atomic claim loses the race (count 0)
 */
function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
function makePrisma() {
  return {
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}), updateMany: jest.fn() },
  };
}
const notifications = { createAndSend: jest.fn().mockResolvedValue({}) } as any;

describe('EmailVerificationService.sendEmailVerification', () => {
  it('throws NotFound for an unknown user', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue(null);
    const svc = new EmailVerificationService(prisma as any, {} as any, notifications);
    await expect(svc.sendEmailVerification('u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('short-circuits when the email is already verified (no email sent)', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', emailVerified: true });
    const email = { sendEmailVerificationCode: jest.fn() } as any;
    const svc = new EmailVerificationService(prisma as any, email, notifications);
    const res = await svc.sendEmailVerification('u1');
    expect(res.message).toMatch(/already verified/i);
    expect(email.sendEmailVerificationCode).not.toHaveBeenCalled();
  });

  it('stores the code HASH and emails the raw code', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'u@test.com',
      firstName: 'A',
      lastName: 'B',
      tenantId: 't1',
      emailVerified: false,
    });
    const email = { sendEmailVerificationCode: jest.fn().mockResolvedValue(true) } as any;
    const svc = new EmailVerificationService(prisma as any, email, notifications);
    await svc.sendEmailVerification('u1');

    const rawCode = email.sendEmailVerificationCode.mock.calls[0][1];
    expect(rawCode).toMatch(/^\d{6}$/);
    const storedHash = prisma.user.update.mock.calls[0][0].data.emailVerificationCodeHash;
    expect(storedHash).toBe(hashCode(rawCode));
    expect(storedHash).not.toBe(rawCode);
  });
});

describe('EmailVerificationService.verifyEmailWithCode', () => {
  function userWithCode(code: string, over: Record<string, unknown> = {}) {
    return {
      id: 'u1',
      email: 'u@test.com',
      tenantId: 't1',
      emailVerificationCodeHash: hashCode(code),
      emailVerificationCodeExpires: new Date(Date.now() + 3600_000),
      ...over,
    };
  }

  it('throws BadRequest for an unknown user (enumeration-safe)', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue(null);
    const svc = new EmailVerificationService(prisma as any, {} as any, notifications);
    await expect(svc.verifyEmailWithCode('ghost@test.com', '123456')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws BadRequest when the code is expired', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue(
      userWithCode('123456', { emailVerificationCodeExpires: new Date(Date.now() - 1000) }),
    );
    const svc = new EmailVerificationService(prisma as any, {} as any, notifications);
    await expect(svc.verifyEmailWithCode('u@test.com', '123456')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws BadRequest on a wrong code', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue(userWithCode('123456'));
    const svc = new EmailVerificationService(prisma as any, {} as any, notifications);
    await expect(svc.verifyEmailWithCode('u@test.com', '000000')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('verifies on a matching, unexpired code (atomic claim succeeds)', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue(userWithCode('123456'));
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    const svc = new EmailVerificationService(prisma as any, {} as any, notifications);
    const res = await svc.verifyEmailWithCode('u@test.com', '123456');
    expect(res).toEqual({ message: 'Email verified successfully', verified: true });
    expect(prisma.user.updateMany).toHaveBeenCalled();
  });

  it('throws BadRequest when the atomic single-use claim loses the race', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue(userWithCode('123456'));
    prisma.user.updateMany.mockResolvedValue({ count: 0 });
    const svc = new EmailVerificationService(prisma as any, {} as any, notifications);
    await expect(svc.verifyEmailWithCode('u@test.com', '123456')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
