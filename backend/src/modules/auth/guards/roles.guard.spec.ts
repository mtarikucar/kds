import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { UserRole } from '../../../common/constants/roles.enum';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Build a `getAllAndOverride` mock that only returns the test-supplied
 * roles when the lookup is for ROLES_KEY. The guard also consults the
 * bypass helper (IS_PUBLIC_KEY etc.) — without keyed mocking, every
 * lookup would falsely return the role list and the guard would short-
 * circuit through the bypass path, never reaching the role check.
 */
function rolesReflector(requiredRoles: UserRole[] | undefined): Reflector {
  const r = new Reflector();
  jest.spyOn(r, 'getAllAndOverride').mockImplementation((key: any) => {
    if (key === ROLES_KEY) return requiredRoles;
    return undefined;
  });
  return r;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  const mockExecutionContext = (user: any): ExecutionContext => {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({
          user,
        }),
      }),
    } as any;
  };

  describe('canActivate', () => {
    it('should return true if no roles are required', () => {
      reflector = rolesReflector(undefined);
      guard = new RolesGuard(reflector);

      const context = mockExecutionContext({ role: UserRole.WAITER });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should return true if user has required role', () => {
      reflector = rolesReflector([UserRole.ADMIN]);
      guard = new RolesGuard(reflector);

      const context = mockExecutionContext({ role: UserRole.ADMIN });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should throw ForbiddenException if user does not have required role', () => {
      // The guard throws rather than returning false so Nest's exception
      // filter can render a 403 with the right message; bool returns
      // would surface as a generic 500. Updated 2026-05 to match the
      // production behaviour.
      reflector = rolesReflector([UserRole.ADMIN]);
      guard = new RolesGuard(reflector);

      const context = mockExecutionContext({ role: UserRole.WAITER });

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should return true if user has one of multiple required roles', () => {
      reflector = rolesReflector([UserRole.ADMIN, UserRole.MANAGER]);
      guard = new RolesGuard(reflector);

      const context = mockExecutionContext({ role: UserRole.MANAGER });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should throw ForbiddenException if user is not authenticated', () => {
      reflector = rolesReflector([UserRole.ADMIN]);
      guard = new RolesGuard(reflector);

      const context = mockExecutionContext(null);

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });
});
