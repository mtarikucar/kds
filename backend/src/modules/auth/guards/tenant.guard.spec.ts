import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { TenantGuard } from './tenant.guard';

describe('TenantGuard', () => {
  let guard: TenantGuard;

  const mockExecutionContext = (
    user: any,
    params: any = {},
  ): ExecutionContext => {
    return {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({
          user,
          params,
        }),
      }),
    } as any;
  };

  beforeEach(() => {
    guard = new TenantGuard();
  });

  describe('canActivate', () => {
    it('should return true when no tenantId in params', () => {
      const user = { tenantId: 'tenant-1' };
      const context = mockExecutionContext(user, {});

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should return true when user tenantId matches param tenantId', () => {
      const user = { tenantId: 'tenant-1' };
      const params = { tenantId: 'tenant-1' };
      const context = mockExecutionContext(user, params);

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should throw ForbiddenException when tenantIds do not match', () => {
      const user = { tenantId: 'tenant-1' };
      const params = { tenantId: 'tenant-2' };
      const context = mockExecutionContext(user, params);

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when user has no tenantId', () => {
      const user = {};
      const params = { tenantId: 'tenant-1' };
      const context = mockExecutionContext(user, params);

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });
});
