import { NotFoundException, BadRequestException } from '@nestjs/common';
import { SuperAdminUsersService } from './superadmin-users.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';
import { UserRole } from '../../../common/constants/roles.enum';

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

/**
 * v3.2.x incident hardening — PATCH /superadmin/users/:id/role is the safe
 * replacement for the raw-DB / Prisma Studio edit that planted an invalid
 * "OWNER" role in production. Load-bearing rules under test: a missing
 * target 404s; demoting a tenant's last active ADMIN is rejected (mirrors
 * UsersService.update's guard); a valid change persists, bumps tokenVersion,
 * revokes outstanding refresh tokens, and emits the same ROLE_CHANGED
 * userActivity event UsersService.update writes.
 */
describe('SuperAdminUsersService.updateRole', () => {
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
    role: 'OWNER', // the incident value — structurally invalid
    status: 'ACTIVE',
    tenantId: TENANT_ID,
    tenant: { name: 'Test Restoran' },
  };

  beforeEach(() => {
    prisma = mockPrismaClient();
    prisma.$transaction.mockImplementation((cb: any) => cb(prisma));
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    svc = new SuperAdminUsersService(prisma as any, audit);
  });

  it('throws NotFound when the target user does not exist (no writes)', async () => {
    prisma.user.findUnique.mockResolvedValue(null as any);
    await expect(
      svc.updateRole(USER_ID, UserRole.ADMIN, ACTOR_ID, ACTOR_EMAIL),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('corrects the invalid OWNER role to ADMIN, persists, and emits ROLE_CHANGED', async () => {
    prisma.user.findUnique.mockResolvedValue(existingUser);
    prisma.user.update.mockResolvedValue({
      id: USER_ID,
      email: existingUser.email,
      role: 'ADMIN',
      tenantId: TENANT_ID,
    } as any);

    const result = await svc.updateRole(
      USER_ID,
      UserRole.ADMIN,
      ACTOR_ID,
      ACTOR_EMAIL,
    );

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_ID },
        data: expect.objectContaining({
          role: 'ADMIN',
          tokenVersion: { increment: 1 },
        }),
      }),
    );
    // Stale tokens (still carrying the invalid OWNER role) must be revoked.
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID, revokedAt: null },
      }),
    );
    // Same event name/shape as UsersService.update's ROLE_CHANGED audit.
    expect(prisma.userActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: USER_ID,
          tenantId: TENANT_ID,
          action: 'ROLE_CHANGED',
          metadata: { by: ACTOR_ID, from: 'OWNER', to: 'ADMIN' },
        }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        entityType: 'USER',
        entityId: USER_ID,
        actorId: ACTOR_ID,
        actorEmail: ACTOR_EMAIL,
        previousData: { role: 'OWNER' },
        newData: expect.objectContaining({ role: 'ADMIN' }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ id: USER_ID, role: 'ADMIN' }),
    );
  });

  it('rejects demoting the last active ADMIN of a tenant', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...existingUser,
      role: UserRole.ADMIN,
    });
    prisma.user.count.mockResolvedValue(0); // no other active admins

    await expect(
      svc.updateRole(USER_ID, UserRole.MANAGER, ACTOR_ID, ACTOR_EMAIL),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('allows demoting an ADMIN when another active admin remains', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...existingUser,
      role: UserRole.ADMIN,
    });
    prisma.user.count.mockResolvedValue(1); // one other active admin
    prisma.user.update.mockResolvedValue({
      id: USER_ID,
      email: existingUser.email,
      role: 'MANAGER',
      tenantId: TENANT_ID,
    } as any);

    await expect(
      svc.updateRole(USER_ID, UserRole.MANAGER, ACTOR_ID, ACTOR_EMAIL),
    ).resolves.toEqual(expect.objectContaining({ role: 'MANAGER' }));
  });

  it('is a no-op when the requested role matches the current role (no writes, no audit)', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...existingUser,
      role: UserRole.ADMIN,
    });

    const result = await svc.updateRole(
      USER_ID,
      UserRole.ADMIN,
      ACTOR_ID,
      ACTOR_EMAIL,
    );

    expect(result).toEqual(
      expect.objectContaining({ id: USER_ID, role: UserRole.ADMIN }),
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('is best-effort: a failing superadmin audit write does not break the mutation', async () => {
    prisma.user.findUnique.mockResolvedValue(existingUser);
    prisma.user.update.mockResolvedValue({
      id: USER_ID,
      email: existingUser.email,
      role: 'ADMIN',
      tenantId: TENANT_ID,
    } as any);
    audit.log.mockRejectedValue(new Error('audit sink down'));
    jest
      .spyOn((svc as any).logger, 'error')
      .mockImplementation(() => undefined);

    await expect(
      svc.updateRole(USER_ID, UserRole.ADMIN, ACTOR_ID, ACTOR_EMAIL),
    ).resolves.toEqual(expect.objectContaining({ role: 'ADMIN' }));
  });
});
