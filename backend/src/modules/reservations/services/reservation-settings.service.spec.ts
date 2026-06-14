import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ReservationSettingsService } from './reservation-settings.service';

/**
 * Spec for ReservationSettingsService — the v3 findFirst + opportunistic-create
 * pattern around the nullable-branch compound key:
 *  - getOrCreate: returns existing, else creates, else recovers from a P2002 race
 *  - update: updates an existing row, else creates, else P2002-recovers
 *  - getPublicSettings: validates tenant (404 missing / 403 inactive) then
 *    projects the public field subset
 */
function makePrisma() {
  return {
    tenant: { findUnique: jest.fn() },
    reservationSettings: {
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  };
}

describe('ReservationSettingsService.getOrCreate', () => {
  it('returns the existing row when present (no create)', async () => {
    const prisma = makePrisma();
    prisma.reservationSettings.findFirst.mockResolvedValue({ id: 's1' });
    const svc = new ReservationSettingsService(prisma as any);
    await expect(svc.getOrCreate('t1')).resolves.toEqual({ id: 's1' });
    expect(prisma.reservationSettings.create).not.toHaveBeenCalled();
  });

  it('creates a row when none exists', async () => {
    const prisma = makePrisma();
    prisma.reservationSettings.findFirst.mockResolvedValue(null);
    prisma.reservationSettings.create.mockResolvedValue({ id: 's2' });
    const svc = new ReservationSettingsService(prisma as any);
    await expect(svc.getOrCreate('t1')).resolves.toEqual({ id: 's2' });
    expect(prisma.reservationSettings.create).toHaveBeenCalledWith({ data: { tenantId: 't1' } });
  });

  it('recovers from a P2002 create race by re-reading', async () => {
    const prisma = makePrisma();
    prisma.reservationSettings.findFirst
      .mockResolvedValueOnce(null) // first lookup: nothing
      .mockResolvedValueOnce({ id: 's3' }); // post-race re-read
    prisma.reservationSettings.create.mockRejectedValue({ code: 'P2002' });
    const svc = new ReservationSettingsService(prisma as any);
    await expect(svc.getOrCreate('t1')).resolves.toEqual({ id: 's3' });
  });

  it('rethrows a non-P2002 create error', async () => {
    const prisma = makePrisma();
    prisma.reservationSettings.findFirst.mockResolvedValue(null);
    prisma.reservationSettings.create.mockRejectedValue({ code: 'P2003' });
    const svc = new ReservationSettingsService(prisma as any);
    await expect(svc.getOrCreate('t1')).rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('ReservationSettingsService.update', () => {
  it('updates the existing row and returns the fresh copy', async () => {
    const prisma = makePrisma();
    prisma.reservationSettings.findFirst.mockResolvedValue({ id: 's1' });
    prisma.reservationSettings.updateMany.mockResolvedValue({ count: 1 });
    prisma.reservationSettings.findFirstOrThrow.mockResolvedValue({ id: 's1', isEnabled: false });
    const svc = new ReservationSettingsService(prisma as any);
    const dto = { isEnabled: false } as any;
    await expect(svc.update('t1', dto)).resolves.toEqual({ id: 's1', isEnabled: false });
    expect(prisma.reservationSettings.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', branchId: null },
      data: dto,
    });
  });

  it('creates when no row exists yet', async () => {
    const prisma = makePrisma();
    prisma.reservationSettings.findFirst.mockResolvedValue(null);
    prisma.reservationSettings.create.mockResolvedValue({ id: 's2', isEnabled: true });
    const svc = new ReservationSettingsService(prisma as any);
    await expect(svc.update('t1', { isEnabled: true } as any)).resolves.toEqual({
      id: 's2',
      isEnabled: true,
    });
  });

  it('recovers from a P2002 create race by updating + re-reading', async () => {
    const prisma = makePrisma();
    prisma.reservationSettings.findFirst.mockResolvedValue(null);
    prisma.reservationSettings.create.mockRejectedValue({ code: 'P2002' });
    prisma.reservationSettings.updateMany.mockResolvedValue({ count: 1 });
    prisma.reservationSettings.findFirstOrThrow.mockResolvedValue({ id: 's3' });
    const svc = new ReservationSettingsService(prisma as any);
    await expect(svc.update('t1', { isEnabled: true } as any)).resolves.toEqual({ id: 's3' });
  });
});

describe('ReservationSettingsService.getPublicSettings', () => {
  it('throws NotFound when the tenant does not exist', async () => {
    const prisma = makePrisma();
    prisma.tenant.findUnique.mockResolvedValue(null);
    const svc = new ReservationSettingsService(prisma as any);
    await expect(svc.getPublicSettings('t1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws Forbidden when the tenant is not ACTIVE', async () => {
    const prisma = makePrisma();
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1', status: 'SUSPENDED' });
    const svc = new ReservationSettingsService(prisma as any);
    await expect(svc.getPublicSettings('t1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('projects only the public subset of settings for an ACTIVE tenant', async () => {
    const prisma = makePrisma();
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1', status: 'ACTIVE' });
    prisma.reservationSettings.findFirst.mockResolvedValue({
      id: 's1',
      tenantId: 't1',
      isEnabled: true,
      maxAdvanceDays: 30,
      requireApproval: true, // private — must NOT leak
      holdOffsetMinutes: 15, // private — must NOT leak
    });
    const svc = new ReservationSettingsService(prisma as any);
    const res = await svc.getPublicSettings('t1');
    expect(res.isEnabled).toBe(true);
    expect(res.maxAdvanceDays).toBe(30);
    expect(res).not.toHaveProperty('requireApproval');
    expect(res).not.toHaveProperty('holdOffsetMinutes');
    expect(res).not.toHaveProperty('id');
  });
});
