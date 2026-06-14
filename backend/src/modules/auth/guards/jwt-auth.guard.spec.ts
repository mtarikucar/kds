import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Spec for JwtAuthGuard's @Public bypass. When the global-auth-bypass helper
 * detects @Public (or other bypass markers) the guard short-circuits to true
 * WITHOUT invoking passport; otherwise it delegates to the passport AuthGuard.
 */
function ctx(): ExecutionContext {
  const handler = () => undefined;
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  it('bypasses passport (returns true) for a @Public route', () => {
    const reflector = new Reflector();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: any) => (key === IS_PUBLIC_KEY ? true : undefined));
    const guard = new JwtAuthGuard(reflector);
    expect(guard.canActivate(ctx())).toBe(true);
  });

  it('delegates to the passport AuthGuard for a protected route', () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const guard = new JwtAuthGuard(reflector);
    // The super.canActivate path returns a value/observable/promise from
    // passport rather than the literal `true` of the bypass branch. We spy on
    // the prototype to confirm delegation without booting a real strategy.
    const superSpy = jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
      .mockReturnValue('delegated' as any);
    const result = guard.canActivate(ctx());
    expect(superSpy).toHaveBeenCalled();
    expect(result).toBe('delegated');
    superSpy.mockRestore();
  });
});
