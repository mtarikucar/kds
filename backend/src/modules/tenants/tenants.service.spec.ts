import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../common/test/prisma-mock.service';
import { TenantsService } from './tenants.service';

/**
 * Spec for TenantsService.updateSettings — the gatekeeping around subdomain
 * changes: tenant existence, ACTIVE-status guard, the customBranding
 * entitlement check (engine value vs plan fallback), quarantine collision,
 * outgoing-subdomain reservation, the audit-activity write, and the
 * P2002→Conflict translation.
 */
describe('TenantsService.updateSettings', () => {
  let prisma: MockPrismaClient;
  let entitlements: { getForTenant: jest.Mock };
  let svc: TenantsService;

  const tenantId = 't-1';

  beforeEach(() => {
    prisma = mockPrismaClient();
    entitlements = { getForTenant: jest.fn() };
    svc = new TenantsService(prisma as any, entitlements as any);
    // default: transaction runs the callback against a tx that proxies prisma
    (prisma.$transaction as any).mockImplementation(async (cb: any) =>
      typeof cb === 'function' ? cb(prisma) : Promise.all(cb),
    );
  });

  function activeTenant(over: Record<string, unknown> = {}) {
    return {
      id: tenantId,
      name: 'Resto',
      subdomain: 'oldsub',
      status: 'ACTIVE',
      ...over,
    };
  }

  it('throws NotFound when the tenant does not exist', async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue(null);
    await expect(
      svc.updateSettings(tenantId, { name: 'X' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws Forbidden when the tenant is not ACTIVE', async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue(
      activeTenant({ status: 'SUSPENDED' }),
    );
    await expect(
      svc.updateSettings(tenantId, { name: 'X' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('updates non-subdomain settings without touching the entitlement engine', async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue(activeTenant());
    (prisma.tenant.update as any).mockResolvedValue({ id: tenantId });

    await svc.updateSettings(tenantId, { name: 'New Name' } as any);

    // no subdomain in the DTO => the customBranding check is never consulted
    expect(entitlements.getForTenant).not.toHaveBeenCalled();
    const data = (prisma.tenant.update as any).mock.calls[0][0].data;
    expect(data).toEqual({ name: 'New Name' });
  });

  it('rejects a subdomain change when customBranding is not granted (engine=false)', async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue(activeTenant());
    entitlements.getForTenant.mockResolvedValue({
      features: { 'feature.customBranding': false },
    });

    await expect(
      svc.updateSettings(tenantId, { subdomain: 'newsub' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.tenant.update as any).not.toHaveBeenCalled();
  });

  it('falls back to the plan column when the engine has no boolean grant', async () => {
    (prisma.tenant.findUnique as any)
      // 1st: load tenant
      .mockResolvedValueOnce(activeTenant())
      // 2nd: plan-fallback lookup inside validateSubdomainChangePermission
      .mockResolvedValueOnce({ currentPlan: { customBranding: false } });
    // engine returns a non-boolean (projector race) => fall through to plan
    entitlements.getForTenant.mockResolvedValue({ features: {} });

    await expect(
      svc.updateSettings(tenantId, { subdomain: 'newsub' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a subdomain change to a quarantined subdomain with Conflict', async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue(activeTenant());
    entitlements.getForTenant.mockResolvedValue({
      features: { 'feature.customBranding': true },
    });
    // isSubdomainQuarantined => reservedSubdomain found within window
    (prisma.reservedSubdomain.findUnique as any).mockResolvedValue({
      subdomain: 'newsub',
      availableAfter: new Date(Date.now() + 86_400_000),
    });

    await expect(
      svc.updateSettings(tenantId, { subdomain: 'newsub' } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('happy path: reserves the outgoing subdomain, updates, and writes an audit activity', async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue(activeTenant());
    entitlements.getForTenant.mockResolvedValue({
      features: { 'feature.customBranding': true },
    });
    (prisma.reservedSubdomain.findUnique as any).mockResolvedValue(null); // not quarantined
    (prisma.reservedSubdomain.upsert as any).mockResolvedValue({});
    (prisma.tenant.update as any).mockResolvedValue({
      id: tenantId,
      subdomain: 'newsub',
    });
    (prisma.userActivity.create as any).mockResolvedValue({});

    await svc.updateSettings(
      tenantId,
      { subdomain: 'newsub', name: 'Resto' } as any,
      'actor-7',
    );

    // outgoing subdomain 'oldsub' parked
    const reserveArgs = (prisma.reservedSubdomain.upsert as any).mock
      .calls[0][0];
    expect(reserveArgs.where.subdomain).toBe('oldsub');
    expect(reserveArgs.create.reason).toBe('subdomain_changed');
    // audit activity records the changed field NAMES (not values)
    const activity = (prisma.userActivity.create as any).mock.calls[0][0].data;
    expect(activity.userId).toBe('actor-7');
    expect(activity.action).toBe('TENANT_SETTINGS_UPDATED');
    expect(activity.metadata.changedFields).toEqual(['subdomain', 'name']);
  });

  it('does not write an audit activity when no actor id is supplied', async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue(activeTenant());
    (prisma.tenant.update as any).mockResolvedValue({ id: tenantId });

    await svc.updateSettings(tenantId, { name: 'Resto' } as any);

    expect(prisma.userActivity.create as any).not.toHaveBeenCalled();
  });

  it('translates a P2002 unique-constraint error to Conflict', async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue(activeTenant());
    entitlements.getForTenant.mockResolvedValue({
      features: { 'feature.customBranding': true },
    });
    (prisma.reservedSubdomain.findUnique as any).mockResolvedValue(null);
    (prisma.reservedSubdomain.upsert as any).mockResolvedValue({});
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'x',
    });
    (prisma.tenant.update as any).mockRejectedValue(p2002);

    await expect(
      svc.updateSettings(tenantId, { subdomain: 'newsub' } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('TenantsService.findSettings / findAllPublic', () => {
  let prisma: MockPrismaClient;
  let svc: TenantsService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new TenantsService(prisma as any, { getForTenant: jest.fn() } as any);
  });

  it('findSettings throws NotFound when the tenant is missing', async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue(null);
    await expect(svc.findSettings('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('findAllPublic only returns ACTIVE tenants ordered by name', async () => {
    (prisma.tenant.findMany as any).mockResolvedValue([]);
    await svc.findAllPublic();
    const args = (prisma.tenant.findMany as any).mock.calls[0][0];
    expect(args.where.status).toBe('ACTIVE');
    expect(args.orderBy).toEqual({ name: 'asc' });
  });
});
