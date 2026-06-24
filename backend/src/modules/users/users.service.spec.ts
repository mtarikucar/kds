import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

/**
 * Iter-74 regression. findAll used to pass filters straight into Prisma:
 *
 *   - filters.search → Prisma `contains` (ILIKE) on firstName / lastName
 *     / email with no length cap. An admin token posting a 1MB needle
 *     made Postgres ILIKE-scan every user row — DoS surface.
 *   - filters.status / filters.role → passed verbatim. A typo'd value
 *     (e.g. "ALL") silently no-matched, hiding the bug from the
 *     operator.
 *
 * iter-74 caps search at 200 chars and allowlists status/role at the
 * service boundary so the failure mode is a 400 the admin UI can
 * surface instead of a confusing empty list.
 */
describe('UsersService.findAll filters (iter-74)', () => {
  let prisma: MockPrismaClient;
  let svc: UsersService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    const config = { get: () => undefined } as any;
    const auth = {} as any;
    svc = new UsersService(
      prisma as any,
      config,
      auth,
      // v2.8.90: EntitlementService stub returns empty set → resolveMaxUsers
      // falls back to plan.maxUsers, matching pre-v2.8.90 behaviour for
      // tests that don't care about add-on capacity.
      {
        getForTenant: jest.fn().mockResolvedValue({
          features: {},
          limits: {},
          integrations: {},
          computedAt: new Date(0).toISOString(),
        }),
      } as any,
    );
    (prisma.user.findMany as any).mockResolvedValue([]);
    (prisma.user.count as any).mockResolvedValue(0);
  });

  it('accepts a normal search', async () => {
    await expect(svc.findAll('t1', { search: 'mehmet' })).resolves.toBeDefined();
  });

  it('rejects search longer than 200 chars (the load-bearing DoS guard)', async () => {
    await expect(svc.findAll('t1', { search: 'x'.repeat(201) })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a 1MB search (paranoid upper bound)', async () => {
    await expect(svc.findAll('t1', { search: 'x'.repeat(1_000_000) })).rejects.toThrow(
      /200 chars/,
    );
  });

  it('rejects status outside the allowlist', async () => {
    await expect(svc.findAll('t1', { status: 'ALL' })).rejects.toThrow(/status/);
    await expect(svc.findAll('t1', { status: 'whatever' })).rejects.toThrow(/status/);
  });

  it('accepts every status in the allowlist', async () => {
    for (const s of ['ACTIVE', 'INACTIVE', 'PENDING', 'REJECTED', 'SUSPENDED']) {
      await expect(svc.findAll('t1', { status: s })).resolves.toBeDefined();
    }
  });

  it('rejects role outside the UserRole enum', async () => {
    await expect(svc.findAll('t1', { role: 'SUPER_ROOT' })).rejects.toThrow(/role/);
  });

  it('builds the tenant-scoped WHERE with the ILIKE OR branches', async () => {
    let capturedWhere: any = null;
    (prisma.user.findMany as any).mockImplementation(async ({ where }: any) => {
      capturedWhere = where;
      return [];
    });

    await svc.findAll('t1', { search: 'foo' });

    expect(capturedWhere.tenantId).toBe('t1');
    expect(capturedWhere.OR).toEqual([
      { firstName: { contains: 'foo', mode: 'insensitive' } },
      { lastName: { contains: 'foo', mode: 'insensitive' } },
      { email: { contains: 'foo', mode: 'insensitive' } },
    ]);
  });
});

/**
 * sweep-3 B2 regression. create() for a front-line role (WAITER/KITCHEN/
 * COURIER) MUST set primaryBranchId or the DB CHECK
 * users_restricted_role_requires_primary_branch rejects the INSERT — which
 * used to surface as an opaque 500 and meant front-line staff could not be
 * created at all. (The CHECK itself only fires against a real DB; this pins
 * the resolution LOGIC — set primaryBranchId + the allow-list row.)
 */
describe('UsersService.create — front-line branch pinning (sweep-3 B2)', () => {
  let prisma: MockPrismaClient;
  let svc: UsersService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new UsersService(
      prisma as any,
      { get: () => undefined } as any,
      {} as any,
      { getForTenant: jest.fn().mockResolvedValue({ features: {}, limits: {}, integrations: {}, computedAt: '' }) } as any,
    );
    (prisma.$transaction as any).mockImplementation(async (cb: any) => cb(prisma));
    (prisma.user.findUnique as any).mockResolvedValue(null); // email free
    (prisma.subscription.findFirst as any).mockResolvedValue(null); // no cap
    (prisma.user.create as any).mockResolvedValue({ id: 'u-new', role: 'WAITER' });
    (prisma.userBranchAssignment.create as any).mockResolvedValue({});
  });

  const dto = { email: 'w@x.y', password: 'pw', firstName: 'W', lastName: 'X', role: 'WAITER' } as any;
  const admin = { id: 'a-1', role: 'ADMIN' };

  it('pins a WAITER to the scoped branch and writes the allow-list row', async () => {
    (prisma.branch.findFirst as any).mockResolvedValue({ id: 'b-scope' }); // scope branch valid in tenant
    await svc.create(dto, 't1', admin, 'b-scope');
    expect((prisma.user.create as any).mock.calls[0][0].data.primaryBranchId).toBe('b-scope');
    expect(prisma.userBranchAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ branchId: 'b-scope', tenantId: 't1' }) }),
    );
  });

  it('falls back to the first active branch when no scope is supplied', async () => {
    (prisma.branch.findFirst as any).mockResolvedValue({ id: 'b-first' });
    await svc.create(dto, 't1', admin);
    expect((prisma.user.create as any).mock.calls[0][0].data.primaryBranchId).toBe('b-first');
  });

  it('rejects with a clear 400 when the tenant has no active branch', async () => {
    (prisma.branch.findFirst as any).mockResolvedValue(null);
    await expect(svc.create(dto, 't1', admin)).rejects.toThrow(/no active branch/i);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('leaves ADMIN branch-less (CHECK exempts roaming roles)', async () => {
    await svc.create({ ...dto, role: 'ADMIN' }, 't1', admin);
    expect((prisma.user.create as any).mock.calls[0][0].data.primaryBranchId).toBeNull();
    expect(prisma.userBranchAssignment.create).not.toHaveBeenCalled();
  });
});
