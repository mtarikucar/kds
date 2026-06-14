import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { AuthService } from './auth.service';

/**
 * Thin-spec for the AuthService delegations + logout that the large
 * auth.service.spec leaves untested. The password / email-verification
 * sub-services are injected via the @Optional trailing constructor params
 * so the facade forwards to the real seams; logout drives prisma directly.
 *
 * Each test fails if a delegation is mis-wired (wrong sub-service / arg
 * order) or if logout stops revoking active refresh tokens.
 */
describe('AuthService — sub-service delegations + logout', () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let passwords: {
    forgotPassword: jest.Mock;
    resetPassword: jest.Mock;
    changePassword: jest.Mock;
  };
  let emailVerification: {
    sendEmailVerification: jest.Mock;
    verifyEmailWithCode: jest.Mock;
  };
  let svc: AuthService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    passwords = {
      forgotPassword: jest.fn().mockResolvedValue({ message: 'sent' }),
      resetPassword: jest.fn().mockResolvedValue({ message: 'reset' }),
      changePassword: jest.fn().mockResolvedValue({ message: 'changed' }),
    };
    emailVerification = {
      sendEmailVerification: jest
        .fn()
        .mockResolvedValue({ message: 'code sent', codeExpiry: new Date() }),
      verifyEmailWithCode: jest
        .fn()
        .mockResolvedValue({ message: 'ok', verified: true }),
    };
    const config = { get: jest.fn(() => undefined) } as any;
    svc = new AuthService(
      prisma as any,
      { sign: jest.fn(), verify: jest.fn(), decode: jest.fn() } as any,
      config,
      {} as any, // EmailService (unused on these paths)
      {} as any, // NotificationsService
      undefined, // metrics
      {} as any, // TokenService (unused here)
      passwords as any, // PasswordService seam
      emailVerification as any, // EmailVerificationService seam
      {} as any, // ProvisioningService
    );
  });

  it('forgotPassword forwards the dto to PasswordService', async () => {
    const dto = { email: 'a@b.c' } as any;
    await expect(svc.forgotPassword(dto)).resolves.toEqual({ message: 'sent' });
    expect(passwords.forgotPassword).toHaveBeenCalledWith(dto);
  });

  it('resetPassword forwards the dto to PasswordService', async () => {
    const dto = { token: 't', newPassword: 'x' } as any;
    await svc.resetPassword(dto);
    expect(passwords.resetPassword).toHaveBeenCalledWith(dto);
  });

  it('changePassword forwards userId + dto to PasswordService', async () => {
    const dto = { currentPassword: 'a', newPassword: 'b' } as any;
    await svc.changePassword('user-1', dto);
    expect(passwords.changePassword).toHaveBeenCalledWith('user-1', dto);
  });

  it('sendEmailVerification forwards the userId to EmailVerificationService', async () => {
    await svc.sendEmailVerification('user-1');
    expect(emailVerification.sendEmailVerification).toHaveBeenCalledWith(
      'user-1',
    );
  });

  it('verifyEmailWithCode forwards email + code to EmailVerificationService', async () => {
    await svc.verifyEmailWithCode('a@b.c', '123456');
    expect(emailVerification.verifyEmailWithCode).toHaveBeenCalledWith(
      'a@b.c',
      '123456',
    );
  });

  describe('logout', () => {
    it('revokes every active refresh token then audits, for a known user', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        tenantId: 't-1',
      });
      (prisma.refreshToken.updateMany as jest.Mock).mockResolvedValue({
        count: 2,
      });
      (prisma.userActivity.create as jest.Mock).mockResolvedValue({});

      const result = await svc.logout('user-1', '1.2.3.4', 'UA');

      expect(result).toEqual({ message: 'Logged out' });
      // Only un-revoked tokens are touched, stamped with a revokedAt date.
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      // Audit row records the LOGOUT with ip + UA.
      expect(prisma.userActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            tenantId: 't-1',
            action: 'LOGOUT',
            ip: '1.2.3.4',
            userAgent: 'UA',
          }),
        }),
      );
    });

    it('is a no-op (still returns Logged out) when the user does not exist', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      const result = await svc.logout('ghost');
      expect(result).toEqual({ message: 'Logged out' });
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.userActivity.create).not.toHaveBeenCalled();
    });
  });
});
