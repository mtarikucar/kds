import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BranchGuard } from './branch.guard';
import { UserRole } from '../../../common/constants/roles.enum';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_SKIP_BRANCH_SCOPE_KEY } from '../decorators/skip-branch-scope.decorator';

/**
 * v3.0.0 — BranchGuard regression set. Pins:
 *   - bypass routes (Public / SuperAdmin / Marketing / SkipBranchScope)
 *   - resolve fallback chain (header → JWT active → JWT primary → tenant fallback)
 *   - ownership/active-status validation
 *   - WAITER hard-restriction
 *   - BRANCH_SCOPE_ENFORCED soft/strict mode
 */

function makeContext(opts: {
  user?: any;
  headers?: Record<string, string>;
  handler?: any;
  cls?: any;
}): ExecutionContext {
  const req = {
    user: opts.user ?? {},
    headers: opts.headers ?? {},
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => opts.handler ?? function dummy() {},
    getClass: () => opts.cls ?? class Dummy {},
  } as unknown as ExecutionContext;
}

function makeReflector(metadata: Record<string, boolean>): Reflector {
  // Mock implementation: getAllAndOverride returns the value if any
  // metadata key matches; for the bypass set we accept the key name.
  return {
    getAllAndOverride: jest.fn((key: string) => metadata[key] ?? false),
  } as unknown as Reflector;
}

function makePrisma(branchRows: Array<{ id: string; tenantId: string; status: string }> = []) {
  const findFirst = jest.fn(async ({ where }: any) => {
    // Compound WHERE on id + tenantId + status.
    return (
      branchRows.find(
        (b) =>
          (where.id == null || b.id === where.id) &&
          (where.tenantId == null || b.tenantId === where.tenantId) &&
          (where.status == null || b.status === where.status),
      ) ?? null
    );
  });
  return { branch: { findFirst } } as any;
}

describe('BranchGuard (v3.0.0)', () => {
  const ORIG_FLAG = process.env.BRANCH_SCOPE_ENFORCED;
  afterEach(() => {
    if (ORIG_FLAG === undefined) delete process.env.BRANCH_SCOPE_ENFORCED;
    else process.env.BRANCH_SCOPE_ENFORCED = ORIG_FLAG;
  });

  it('bypasses entirely on @Public()', async () => {
    delete process.env.BRANCH_SCOPE_ENFORCED;
    const guard = new BranchGuard(makeReflector({ [IS_PUBLIC_KEY]: true }), makePrisma());
    const ctx = makeContext({});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('bypasses on @SkipBranchScope() even when auth is present', async () => {
    delete process.env.BRANCH_SCOPE_ENFORCED;
    const guard = new BranchGuard(
      makeReflector({ [IS_SKIP_BRANCH_SCOPE_KEY]: true }),
      makePrisma(),
    );
    const ctx = makeContext({
      user: { tenantId: 't-1', role: UserRole.ADMIN },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('resolves branchId from X-Branch-Id header when present', async () => {
    delete process.env.BRANCH_SCOPE_ENFORCED;
    const branchId = '11111111-2222-3333-4444-555555555555';
    const prisma = makePrisma([{ id: branchId, tenantId: 't-1', status: 'active' }]);
    const guard = new BranchGuard(makeReflector({}), prisma);
    const ctx = makeContext({
      user: { tenantId: 't-1', role: UserRole.ADMIN },
      headers: { 'x-branch-id': branchId },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    const req = (ctx.switchToHttp().getRequest as any)();
    expect(req.branchId).toBe(branchId);
  });

  it('falls back through chain: header → activeBranchId → primaryBranchId → tenant default', async () => {
    delete process.env.BRANCH_SCOPE_ENFORCED;
    const primaryId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const prisma = makePrisma([{ id: primaryId, tenantId: 't-1', status: 'active' }]);
    const guard = new BranchGuard(makeReflector({}), prisma);
    const ctx = makeContext({
      user: {
        tenantId: 't-1',
        role: UserRole.ADMIN,
        primaryBranchId: primaryId,
      },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((ctx.switchToHttp().getRequest as any)().branchId).toBe(primaryId);
  });

  it('uses tenant single active branch when all JWT claims are absent', async () => {
    delete process.env.BRANCH_SCOPE_ENFORCED;
    const id = 'cccccccc-dddd-eeee-ffff-000000000000';
    const prisma = makePrisma([{ id, tenantId: 't-1', status: 'active' }]);
    const guard = new BranchGuard(makeReflector({}), prisma);
    const ctx = makeContext({ user: { tenantId: 't-1', role: UserRole.ADMIN } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((ctx.switchToHttp().getRequest as any)().branchId).toBe(id);
  });

  it('rejects cross-tenant X-Branch-Id with 403', async () => {
    delete process.env.BRANCH_SCOPE_ENFORCED;
    const otherId = 'dddddddd-eeee-ffff-1111-222222222222';
    // findFirst returns null because the WHERE includes tenantId=t-1.
    const prisma = makePrisma([{ id: otherId, tenantId: 'other-tenant', status: 'active' }]);
    const guard = new BranchGuard(makeReflector({}), prisma);
    const ctx = makeContext({
      user: { tenantId: 't-1', role: UserRole.ADMIN },
      headers: { 'x-branch-id': otherId },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects archived branch (status != active) with 403', async () => {
    delete process.env.BRANCH_SCOPE_ENFORCED;
    const archivedId = '99999999-8888-7777-6666-555555555555';
    const prisma = makePrisma([{ id: archivedId, tenantId: 't-1', status: 'archived' }]);
    const guard = new BranchGuard(makeReflector({}), prisma);
    const ctx = makeContext({
      user: { tenantId: 't-1', role: UserRole.ADMIN },
      headers: { 'x-branch-id': archivedId },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('hard-restricts WAITER: X-Branch-Id different from primaryBranchId → 403', async () => {
    delete process.env.BRANCH_SCOPE_ENFORCED;
    const primaryId = 'aaaaaaaa-1111-2222-3333-444444444444';
    const otherBranchId = 'bbbbbbbb-1111-2222-3333-444444444444';
    const prisma = makePrisma([
      { id: primaryId, tenantId: 't-1', status: 'active' },
      { id: otherBranchId, tenantId: 't-1', status: 'active' },
    ]);
    const guard = new BranchGuard(makeReflector({}), prisma);
    const ctx = makeContext({
      user: {
        tenantId: 't-1',
        role: UserRole.WAITER,
        primaryBranchId: primaryId,
      },
      headers: { 'x-branch-id': otherBranchId },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('hard-restricts KITCHEN role same way', async () => {
    delete process.env.BRANCH_SCOPE_ENFORCED;
    const primaryId = 'aaaaaaaa-1111-2222-3333-444444444444';
    const otherBranchId = 'bbbbbbbb-1111-2222-3333-444444444444';
    const prisma = makePrisma([
      { id: primaryId, tenantId: 't-1', status: 'active' },
      { id: otherBranchId, tenantId: 't-1', status: 'active' },
    ]);
    const guard = new BranchGuard(makeReflector({}), prisma);
    const ctx = makeContext({
      user: {
        tenantId: 't-1',
        role: UserRole.KITCHEN,
        primaryBranchId: primaryId,
      },
      headers: { 'x-branch-id': otherBranchId },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('MANAGER may switch branches freely (hard-restriction does not apply)', async () => {
    delete process.env.BRANCH_SCOPE_ENFORCED;
    const aId = 'aaaaaaaa-1111-2222-3333-444444444444';
    const bId = 'bbbbbbbb-1111-2222-3333-444444444444';
    const prisma = makePrisma([
      { id: aId, tenantId: 't-1', status: 'active' },
      { id: bId, tenantId: 't-1', status: 'active' },
    ]);
    const guard = new BranchGuard(makeReflector({}), prisma);
    const ctx = makeContext({
      user: { tenantId: 't-1', role: UserRole.MANAGER, primaryBranchId: aId },
      headers: { 'x-branch-id': bId },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((ctx.switchToHttp().getRequest as any)().branchId).toBe(bId);
  });

  it('drops malformed X-Branch-Id and falls back to next chain link', async () => {
    delete process.env.BRANCH_SCOPE_ENFORCED;
    const primaryId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const prisma = makePrisma([{ id: primaryId, tenantId: 't-1', status: 'active' }]);
    const guard = new BranchGuard(makeReflector({}), prisma);
    const ctx = makeContext({
      user: { tenantId: 't-1', role: UserRole.ADMIN, primaryBranchId: primaryId },
      headers: { 'x-branch-id': 'not a uuid!!' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((ctx.switchToHttp().getRequest as any)().branchId).toBe(primaryId);
  });

  it('soft mode: no resolvable branch → req.branchId = null, request passes', async () => {
    delete process.env.BRANCH_SCOPE_ENFORCED; // soft mode default
    const prisma = makePrisma([]); // no branches at all for tenant
    const guard = new BranchGuard(makeReflector({}), prisma);
    const ctx = makeContext({ user: { tenantId: 'orphan-tenant', role: UserRole.ADMIN } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((ctx.switchToHttp().getRequest as any)().branchId).toBeNull();
  });

  it('strict mode (BRANCH_SCOPE_ENFORCED=true): no resolvable branch → 403', async () => {
    process.env.BRANCH_SCOPE_ENFORCED = 'true';
    const prisma = makePrisma([]);
    const guard = new BranchGuard(makeReflector({}), prisma);
    const ctx = makeContext({ user: { tenantId: 'orphan-tenant', role: UserRole.ADMIN } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
