import { AuthProvisioningService } from './auth-provisioning.service';
import { ResourceNotFoundException } from '../../../common/exceptions';

/**
 * Spec for the standalone (non-transactional) AuthProvisioningService helpers:
 *  - allocateSubdomain: returns the preferred slug when free; appends a random
 *    suffix when taken/quarantined; defaults a blank base to "restaurant"
 *  - loadBusinessPlanOrThrow: throws when the plan is missing or has no trial
 *  - buildPlanFeatureOverrides: coerces every plan flag to a strict boolean
 */
function makePrisma() {
  return {
    reservedSubdomain: { findUnique: jest.fn().mockResolvedValue(null) },
    tenant: { findUnique: jest.fn().mockResolvedValue(null) },
    subscriptionPlan: { findUnique: jest.fn() },
  };
}

describe('AuthProvisioningService.allocateSubdomain', () => {
  it('returns the preferred slug when it is free', async () => {
    const prisma = makePrisma();
    const svc = new AuthProvisioningService(prisma as any);
    await expect(svc.allocateSubdomain('acme')).resolves.toBe('acme');
  });

  it('defaults a blank base to "restaurant"', async () => {
    const prisma = makePrisma();
    const svc = new AuthProvisioningService(prisma as any);
    await expect(svc.allocateSubdomain('')).resolves.toBe('restaurant');
  });

  it('appends a random suffix when the preferred slug is already taken', async () => {
    const prisma = makePrisma();
    // preferred lookup returns a row (taken); suffixed candidates are free
    prisma.tenant.findUnique
      .mockResolvedValueOnce({ id: 'existing' }) // preferred taken
      .mockResolvedValue(null); // candidates free
    const svc = new AuthProvisioningService(prisma as any);
    const result = await svc.allocateSubdomain('acme');
    expect(result).toMatch(/^acme-[0-9a-f]{6}$/);
  });

  it('throws after exhausting suffix attempts', async () => {
    const prisma = makePrisma();
    prisma.tenant.findUnique.mockResolvedValue({ id: 'always-taken' });
    const svc = new AuthProvisioningService(prisma as any);
    await expect(svc.allocateSubdomain('acme')).rejects.toThrow(/Could not allocate/);
  });
});

describe('AuthProvisioningService.loadBusinessPlanOrThrow', () => {
  it('returns the plan when seeded with a positive trial', async () => {
    const prisma = makePrisma();
    prisma.subscriptionPlan.findUnique.mockResolvedValue({ name: 'BUSINESS', trialDays: 14 });
    const svc = new AuthProvisioningService(prisma as any);
    await expect(svc.loadBusinessPlanOrThrow()).resolves.toMatchObject({ trialDays: 14 });
  });

  it('throws when the BUSINESS plan is missing (seed misconfig)', async () => {
    const prisma = makePrisma();
    prisma.subscriptionPlan.findUnique.mockResolvedValue(null);
    const svc = new AuthProvisioningService(prisma as any);
    await expect(svc.loadBusinessPlanOrThrow()).rejects.toBeInstanceOf(ResourceNotFoundException);
  });

  it('throws when the plan has no trialDays', async () => {
    const prisma = makePrisma();
    prisma.subscriptionPlan.findUnique.mockResolvedValue({ name: 'BUSINESS', trialDays: 0 });
    const svc = new AuthProvisioningService(prisma as any);
    await expect(svc.loadBusinessPlanOrThrow()).rejects.toBeInstanceOf(ResourceNotFoundException);
  });
});

describe('AuthProvisioningService.buildPlanFeatureOverrides', () => {
  const svc = new AuthProvisioningService(makePrisma() as any);

  it('coerces truthy flags to true and null/undefined to false', () => {
    const overrides = svc.buildPlanFeatureOverrides({
      advancedReports: true,
      multiLocation: false,
      customBranding: null,
      apiAccess: undefined,
      inventoryTracking: true,
    });
    expect(overrides.advancedReports).toBe(true);
    expect(overrides.multiLocation).toBe(false);
    expect(overrides.customBranding).toBe(false);
    expect(overrides.apiAccess).toBe(false);
    expect(overrides.inventoryTracking).toBe(true);
  });

  it('always returns the full set of ten feature flags as booleans', () => {
    const overrides = svc.buildPlanFeatureOverrides({});
    const keys = Object.keys(overrides);
    expect(keys).toHaveLength(10);
    for (const v of Object.values(overrides)) {
      expect(typeof v).toBe('boolean');
    }
  });
});
