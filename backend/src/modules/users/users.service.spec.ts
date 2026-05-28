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
    svc = new UsersService(prisma as any, config, auth);
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
