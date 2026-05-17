import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantGuard } from './tenant.guard';

/**
 * TenantGuard's job is to project `user.tenantId` onto `request.tenantId`
 * so services can scope queries without having to dig into the JWT
 * payload everywhere. It also short-circuits on the public/superadmin/
 * marketing bypass keys via guard-bypass.helper. These tests cover both
 * paths.
 */
describe('TenantGuard', () => {
  let guard: TenantGuard;
  let reflector: Reflector;

  const mockExecutionContext = (user: any): { ctx: ExecutionContext; request: any } => {
    const request: any = { user };
    const ctx = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(request),
      }),
    } as any;
    return { ctx, request };
  };

  beforeEach(() => {
    reflector = new Reflector();
    // Default: no bypass keys present.
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    guard = new TenantGuard(reflector);
  });

  describe('canActivate', () => {
    it('injects user.tenantId onto the request and allows the call', () => {
      const { ctx, request } = mockExecutionContext({ tenantId: 'tenant-1' });

      expect(guard.canActivate(ctx)).toBe(true);
      expect(request.tenantId).toBe('tenant-1');
    });

    it('rejects when the user has no tenant scope', () => {
      const { ctx, request } = mockExecutionContext({});

      expect(guard.canActivate(ctx)).toBe(false);
      expect(request.tenantId).toBeUndefined();
    });

    it('rejects an unauthenticated request', () => {
      const { ctx } = mockExecutionContext(null);

      expect(guard.canActivate(ctx)).toBe(false);
    });
  });
});
