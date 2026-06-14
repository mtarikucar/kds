import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import { Public, IS_PUBLIC_KEY } from './public.decorator';
import { CurrentUser } from './current-user.decorator';
import { CurrentScope } from './current-scope.decorator';

/**
 * Specs for the auth param/metadata decorators.
 *  - @Public sets isPublic=true metadata (the global JwtAuthGuard bypass key)
 *  - @CurrentUser returns req.user (or a field) and throws when no user is set
 *  - @CurrentScope returns req.scope and throws when BranchGuard didn't run
 *
 * Param decorators are exercised via the standard NestJS technique: apply the
 * decorator to a dummy method, pull its factory out of ROUTE_ARGS_METADATA,
 * and invoke it against a fake ExecutionContext.
 */
function ctxWith(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function getParamFactory(decorator: (...args: any[]) => any): (data: any, ctx: ExecutionContext) => any {
  class Probe {
    method(@decorator() _value: unknown) {
      /* noop */
    }
  }
  const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'method');
  const key = Object.keys(meta)[0];
  return meta[key].factory;
}

describe('@Public', () => {
  it('sets the isPublic metadata flag to true', () => {
    class Probe {
      @Public()
      handler() {}
    }
    const value = Reflect.getMetadata(IS_PUBLIC_KEY, Probe.prototype.handler);
    expect(IS_PUBLIC_KEY).toBe('isPublic');
    expect(value).toBe(true);
  });
});

describe('@CurrentUser', () => {
  const factory = getParamFactory(CurrentUser);

  it('returns the whole user when no field requested', () => {
    const user = { id: 'u1', role: 'ADMIN' };
    expect(factory(undefined, ctxWith({ user }))).toBe(user);
  });

  it('returns a single field when data is provided', () => {
    expect(factory('id', ctxWith({ user: { id: 'u1' } }))).toBe('u1');
  });

  it('throws when the route had no auth guard (no req.user)', () => {
    expect(() => factory(undefined, ctxWith({}))).toThrow(InternalServerErrorException);
  });
});

describe('@CurrentScope', () => {
  const factory = getParamFactory(CurrentScope);

  it('returns the resolved BranchScope from req.scope', () => {
    const scope = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'MANAGER' };
    expect(factory(undefined, ctxWith({ scope }))).toBe(scope);
  });

  it('throws when BranchGuard did not set req.scope', () => {
    expect(() => factory(undefined, ctxWith({}))).toThrow(/BranchGuard/);
  });
});
