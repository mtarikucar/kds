import { EntitlementsController } from './entitlements.controller';

/**
 * Thin-controller spec for the entitlements read endpoint. `me` reads the
 * tenantId off the JWT and null-coalesces an absent branchId (the
 * dashboard hits this before a branch is selected, so branchId is
 * optional). Both are forwarded to getForTenant in the right order.
 */
describe('EntitlementsController', () => {
  let entitlements: { getForTenant: jest.Mock };
  let ctrl: EntitlementsController;

  beforeEach(() => {
    entitlements = {
      getForTenant: jest.fn().mockResolvedValue({ features: {} }),
    };
    ctrl = new EntitlementsController(entitlements as any);
  });

  it('forwards tenantId + branchId from the JWT', async () => {
    await ctrl.me({ user: { tenantId: 't1', branchId: 'b1' } });
    expect(entitlements.getForTenant).toHaveBeenCalledWith('t1', 'b1');
  });

  it('coalesces an absent branchId to null (no branch selected yet)', async () => {
    await ctrl.me({ user: { tenantId: 't1' } });
    expect(entitlements.getForTenant).toHaveBeenCalledWith('t1', null);
  });

  it('returns the effective entitlement set from the service', async () => {
    entitlements.getForTenant.mockResolvedValue({ features: { pos: true } });
    await expect(
      ctrl.me({ user: { tenantId: 't1', branchId: 'b1' } }),
    ).resolves.toEqual({ features: { pos: true } });
  });
});
