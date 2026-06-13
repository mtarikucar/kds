import { EntitlementGuard } from './entitlement.guard';

function ctx(req: any) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;
}

describe('EntitlementGuard branch resolution', () => {
  it('resolves the entitlement set with req.scope.branchId, not req.user.branchId', async () => {
    const entitlements = { getForTenant: jest.fn().mockResolvedValue({ features: {}, limits: {}, integrations: {} }) };
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValueOnce(false)            // IS_PUBLIC_KEY
        .mockReturnValueOnce(['posAccess']),   // REQUIRE_ENTITLEMENT_KEY
    };
    const guard = new EntitlementGuard(reflector as any, entitlements as any);
    const req = { user: { tenantId: 't-1' }, scope: { tenantId: 't-1', branchId: 'b-1' } };
    await guard.canActivate(ctx(req)).catch(() => undefined);
    expect(entitlements.getForTenant).toHaveBeenCalledWith('t-1', 'b-1');
  });
});
