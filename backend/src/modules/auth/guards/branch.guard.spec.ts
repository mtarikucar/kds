import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BranchGuard } from './branch.guard';
import { UserRole } from '../../../common/constants/roles.enum';

/**
 * BranchGuard is the load-bearing gate for every branch-scoped route.
 * The spec asserts five contracts:
 *
 *   1. Missing X-Branch-Id → 400 (no optimistic fallback).
 *   2. Header for a cross-tenant or archived branch → 403.
 *   3. WAITER/KITCHEN/COURIER attempting any branch other than
 *      primaryBranchId → 403.
 *   4. MANAGER attempting a branch outside allowedBranchIds → 403.
 *   5. ADMIN with empty allowedBranchIds → wildcard tenant access.
 *
 * The static canAccessBranchStatic shim is exercised separately so
 * the WebSocket gateways can reuse it without dragging the guard.
 */
describe('BranchGuard', () => {
  let prisma: any;
  let guard: BranchGuard;
  let reflector: Reflector;

  function makeCtx(opts: {
    user?: any;
    headers?: Record<string, string>;
    public?: boolean;
    skipBranch?: boolean;
  }): ExecutionContext {
    return {
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({
        getRequest: () => ({
          user: opts.user,
          headers: opts.headers ?? {},
        }),
      }),
    } as any;
  }

  beforeEach(() => {
    prisma = {
      branch: { findFirst: jest.fn() },
    };
    reflector = new Reflector();
    // Default: route is neither public nor skip-branch-scoped.
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    guard = new BranchGuard(reflector, prisma);
  });

  it('passes through public routes without touching the DB', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const ctx = makeCtx({});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.branch.findFirst).not.toHaveBeenCalled();
  });

  it('rejects with 400 when X-Branch-Id is missing', async () => {
    const ctx = makeCtx({
      user: { id: 'u-1', tenantId: 't-1', role: UserRole.ADMIN },
      headers: {},
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(BadRequestException);
    expect(prisma.branch.findFirst).not.toHaveBeenCalled();
  });

  it('rejects with 400 when X-Branch-Id is malformed', async () => {
    const ctx = makeCtx({
      user: { id: 'u-1', tenantId: 't-1', role: UserRole.ADMIN },
      headers: { 'x-branch-id': 'not-a-uuid' },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(BadRequestException);
    expect(prisma.branch.findFirst).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the branch is not owned by the tenant', async () => {
    prisma.branch.findFirst.mockResolvedValue(null);
    const ctx = makeCtx({
      user: {
        id: 'u-1',
        tenantId: 't-1',
        role: UserRole.ADMIN,
        primaryBranchId: null,
        allowedBranchIds: [],
      },
      headers: { 'x-branch-id': '11111111-1111-1111-1111-111111111111' },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('rejects with 403 when WAITER targets a branch other than primary', async () => {
    prisma.branch.findFirst.mockResolvedValue({ id: 'b-x' });
    const ctx = makeCtx({
      user: {
        id: 'u-1',
        tenantId: 't-1',
        role: UserRole.WAITER,
        primaryBranchId: 'b-primary',
        allowedBranchIds: ['b-primary'],
      },
      headers: { 'x-branch-id': '22222222-2222-2222-2222-222222222222' },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('rejects with 403 when MANAGER targets a branch outside the allow-list', async () => {
    prisma.branch.findFirst.mockResolvedValue({ id: 'b-other' });
    const ctx = makeCtx({
      user: {
        id: 'u-mgr',
        tenantId: 't-1',
        role: UserRole.MANAGER,
        primaryBranchId: 'b-a',
        allowedBranchIds: ['b-a', 'b-b'],
      },
      headers: { 'x-branch-id': '33333333-3333-3333-3333-333333333333' },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('allows ADMIN with empty allowedBranchIds (wildcard owner)', async () => {
    const headerBranchId = '44444444-4444-4444-4444-444444444444';
    prisma.branch.findFirst.mockResolvedValue({ id: headerBranchId });
    const request: any = {
      user: {
        id: 'u-admin',
        tenantId: 't-1',
        role: UserRole.ADMIN,
        primaryBranchId: null,
        allowedBranchIds: [],
      },
      headers: { 'x-branch-id': headerBranchId },
    };
    const ctx = {
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.scope).toEqual({
      tenantId: 't-1',
      branchId: headerBranchId,
      userId: 'u-admin',
      role: UserRole.ADMIN,
    });
  });

  it('allows WAITER when header matches primaryBranchId', async () => {
    const headerBranchId = '55555555-5555-5555-5555-555555555555';
    prisma.branch.findFirst.mockResolvedValue({ id: headerBranchId });
    const request: any = {
      user: {
        id: 'u-waiter',
        tenantId: 't-1',
        role: UserRole.WAITER,
        primaryBranchId: headerBranchId,
        allowedBranchIds: [headerBranchId],
      },
      headers: { 'x-branch-id': headerBranchId },
    };
    const ctx = {
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.scope.branchId).toBe(headerBranchId);
  });

  it('refuses WAITER whose primaryBranchId got stripped from the JWT (re-login signal)', () => {
    const ok = BranchGuard.canAccessBranchStatic(
      UserRole.WAITER,
      'b-1',
      null,
      [],
    );
    expect(ok).toBe(false);
  });

  it('bypasses for routes annotated @SkipBranchScope()', async () => {
    // First override call (public-route check) returns false; second
    // (skip-branch) returns true.
    let callCount = 0;
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation(() => ++callCount === 2);
    const ctx = makeCtx({});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.branch.findFirst).not.toHaveBeenCalled();
  });

  it('rejects when req.user is missing (guard chain misconfig)', async () => {
    const ctx = makeCtx({ headers: { 'x-branch-id': '00000000-0000-0000-0000-000000000000' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });
});
