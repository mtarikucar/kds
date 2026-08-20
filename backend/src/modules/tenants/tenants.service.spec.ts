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

  it('falls back to the free baseline when the engine has no boolean grant', async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue(activeTenant());
    // Engine returns a non-boolean (projector race). The fallback used to read
    // `currentPlan.customBranding`, which 20260811120000_free_core turned into
    // a guaranteed false by nulling every currentPlanId — so covering for a
    // race meant denying a FREE feature. customBranding is in
    // FREE_BASELINE_GRANTS, so the race must resolve to "allowed".
    entitlements.getForTenant.mockResolvedValue({ features: {} });

    await expect(
      svc.updateSettings(tenantId, { subdomain: 'newsub' } as any),
    ).resolves.not.toThrow();
    expect(prisma.tenant.update as any).toHaveBeenCalled();
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

  it('still rejects a subdomain quarantined by ANOTHER tenant with Conflict', async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue(activeTenant());
    entitlements.getForTenant.mockResolvedValue({
      features: { 'feature.customBranding': true },
    });
    (prisma.reservedSubdomain.findUnique as any).mockResolvedValue({
      subdomain: 'newsub',
      availableAfter: new Date(Date.now() + 86_400_000),
      tenantId: 't-someone-else',
    });

    await expect(
      svc.updateSettings(tenantId, { subdomain: 'newsub' } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.tenant.update as any).not.toHaveBeenCalled();
  });

  it('allows a tenant to reclaim its OWN quarantined subdomain (rename undo)', async () => {
    // The tenant renamed oldsub → currentsub earlier; 'oldsub' sits in
    // quarantine stamped with THIS tenant. Renaming back must succeed —
    // the quarantine only exists to block takeover by OTHERS.
    (prisma.tenant.findUnique as any).mockResolvedValue(
      activeTenant({ subdomain: 'currentsub' }),
    );
    entitlements.getForTenant.mockResolvedValue({
      features: { 'feature.customBranding': true },
    });
    (prisma.reservedSubdomain.findUnique as any).mockResolvedValue({
      subdomain: 'oldsub',
      availableAfter: new Date(Date.now() + 86_400_000),
      tenantId, // owned by the requesting tenant
    });
    (prisma.reservedSubdomain.upsert as any).mockResolvedValue({});
    (prisma.tenant.update as any).mockResolvedValue({
      id: tenantId,
      subdomain: 'oldsub',
    });

    await svc.updateSettings(tenantId, { subdomain: 'oldsub' } as any);

    const data = (prisma.tenant.update as any).mock.calls[0][0].data;
    expect(data).toEqual({ subdomain: 'oldsub' });
    // The outgoing 'currentsub' is parked in turn, stamped with the owner.
    const reserveArgs = (prisma.reservedSubdomain.upsert as any).mock
      .calls[0][0];
    expect(reserveArgs.where.subdomain).toBe('currentsub');
    expect(reserveArgs.create.tenantId).toBe(tenantId);
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

    // outgoing subdomain 'oldsub' parked, stamped with the releasing tenant
    // so it can reclaim the name later (own-quarantine reclaim).
    const reserveArgs = (prisma.reservedSubdomain.upsert as any).mock
      .calls[0][0];
    expect(reserveArgs.where.subdomain).toBe('oldsub');
    expect(reserveArgs.create.reason).toBe('subdomain_changed');
    expect(reserveArgs.create.tenantId).toBe(tenantId);
    expect(reserveArgs.update.tenantId).toBe(tenantId);
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

  /**
   * The product editor / menu-import review grid need the tenant's ACTUAL
   * allowed tax band to offer as <option>s, not a hardcoded Turkish one —
   * otherwise a UZ operator can enter 12% via the API (backend validator)
   * but never see it as a choice in the UI. Derived from the country
   * profile, not a new column.
   */
  it('findSettings adds taxRates + defaultTaxRate DERIVED from the TR profile', async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue({
      id: 't-1',
      countryCode: 'TR',
    });
    const settings = await svc.findSettings('t-1');
    expect(settings.taxRates).toEqual([0, 1, 10, 20]);
    expect(settings.defaultTaxRate).toBe(10);
  });

  it("findSettings adds the UZ tenant's OWN band (0/6/12), not Turkey's", async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue({
      id: 't-1',
      countryCode: 'UZ',
    });
    const settings = await svc.findSettings('t-1');
    expect(settings.taxRates).toEqual([0, 6, 12]);
    expect(settings.defaultTaxRate).toBe(12);
  });

  it('findSettings falls back to the TR band when countryCode is missing (legacy row)', async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue({
      id: 't-1',
      countryCode: null,
    });
    const settings = await svc.findSettings('t-1');
    expect(settings.taxRates).toEqual([0, 1, 10, 20]);
    expect(settings.defaultTaxRate).toBe(10);
  });

  /**
   * The operator-typed tax-id field (Branding/Accounting settings, the
   * manual-invoice modal) needs the tenant's ACTUAL shape rules to render
   * the right label and to stop guessing a client-side pattern — see
   * useCountryProfile() on the frontend. RegExp doesn't survive JSON, so
   * this ships the pattern SOURCE string, not a RegExp instance.
   */
  it("findSettings adds taxIdRules serialized (pattern as a source string) from the TR profile", async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue({
      id: 't-1',
      countryCode: 'TR',
    });
    const settings = await svc.findSettings('t-1');
    expect(settings.taxIdRules).toEqual([
      { name: 'VKN', pattern: '^\\d{10}$', labelKey: 'country.taxId.vkn' },
      { name: 'TCKN', pattern: '^\\d{11}$', labelKey: 'country.taxId.tckn' },
    ]);
  });

  it("findSettings adds the UZ tenant's OWN taxIdRules (STIR/PINFL), not Turkey's", async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue({
      id: 't-1',
      countryCode: 'UZ',
    });
    const settings = await svc.findSettings('t-1');
    expect(settings.taxIdRules).toEqual([
      { name: 'STIR', pattern: '^\\d{9}$', labelKey: 'country.taxId.stir' },
      { name: 'PINFL', pattern: '^\\d{14}$', labelKey: 'country.taxId.pinfl' },
    ]);
  });

  it('findAllPublic only returns ACTIVE tenants ordered by name', async () => {
    (prisma.tenant.findMany as any).mockResolvedValue([]);
    await svc.findAllPublic();
    const args = (prisma.tenant.findMany as any).mock.calls[0][0];
    expect(args.where.status).toBe('ACTIVE');
    expect(args.orderBy).toEqual({ name: 'asc' });
  });
});
