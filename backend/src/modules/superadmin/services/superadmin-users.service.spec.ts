import { NotFoundException } from '@nestjs/common';
import { SuperAdminUsersService } from './superadmin-users.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

/**
 * Unit tests for the privileged setEmailVerified support action. This flag
 * bypasses the email-verify gate (and the payments-intent gate that depends
 * on it), so the service must leave an audit trail capturing actor + before/
 * after — and that audit write must be best-effort (a logging failure may
 * never break the support action that already committed).
 */
describe('SuperAdminUsersService.setEmailVerified', () => {
  let prisma: MockPrismaClient;
  let audit: any;
  let svc: SuperAdminUsersService;

  const USER_ID = 'user-1';
  const TENANT_ID = 'tenant-1';
  const ACTOR_ID = 'sa-1';
  const ACTOR_EMAIL = 'admin@platform.com';

  const existingUser: any = {
    id: USER_ID,
    email: 'owner@restoran.com',
    emailVerified: false,
    tenantId: TENANT_ID,
    tenant: { name: 'Test Restoran' },
  };

  beforeEach(() => {
    prisma = mockPrismaClient();
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    svc = new SuperAdminUsersService(prisma as any, audit);
  });

  it('throws NotFound when the user does not exist (no audit written)', async () => {
    prisma.user.findUnique.mockResolvedValue(null as any);
    await expect(
      svc.setEmailVerified(USER_ID, true, ACTOR_ID, ACTOR_EMAIL),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('updates the flag and writes an audit record with actor + before/after', async () => {
    prisma.user.findUnique.mockResolvedValue(existingUser);
    prisma.user.update.mockResolvedValue({
      id: USER_ID,
      email: existingUser.email,
      emailVerified: true,
    } as any);

    const result = await svc.setEmailVerified(
      USER_ID,
      true,
      ACTOR_ID,
      ACTOR_EMAIL,
    );

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_ID },
        data: { emailVerified: true },
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ id: USER_ID, emailVerified: true }),
    );
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        entityType: 'USER',
        entityId: USER_ID,
        actorId: ACTOR_ID,
        actorEmail: ACTOR_EMAIL,
        previousData: { emailVerified: false },
        newData: expect.objectContaining({
          emailVerified: true,
          targetEmail: existingUser.email,
        }),
        targetTenantId: TENANT_ID,
        targetTenantName: 'Test Restoran',
      }),
    );
  });

  it('captures the de-verify transition (true -> false) in before/after', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...existingUser,
      emailVerified: true,
    });
    prisma.user.update.mockResolvedValue({
      id: USER_ID,
      email: existingUser.email,
      emailVerified: false,
    } as any);

    await svc.setEmailVerified(USER_ID, false, ACTOR_ID, ACTOR_EMAIL);

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        previousData: { emailVerified: true },
        newData: expect.objectContaining({ emailVerified: false }),
      }),
    );
  });

  it('is best-effort: a failing audit write does not break the mutation', async () => {
    prisma.user.findUnique.mockResolvedValue(existingUser);
    const updated = {
      id: USER_ID,
      email: existingUser.email,
      emailVerified: true,
    };
    prisma.user.update.mockResolvedValue(updated as any);
    audit.log.mockRejectedValue(new Error('audit sink down'));
    // Silence the expected error log so the suite output stays clean.
    jest
      .spyOn((svc as any).logger, 'error')
      .mockImplementation(() => undefined);

    // The business write still resolves with the updated row.
    await expect(
      svc.setEmailVerified(USER_ID, true, ACTOR_ID, ACTOR_EMAIL),
    ).resolves.toEqual(expect.objectContaining({ emailVerified: true }));
    expect(audit.log).toHaveBeenCalledTimes(1);
  });
});
