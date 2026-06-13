import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../common/test/prisma-mock.service';
import { SmsSettingsService } from './sms-settings.service';

/**
 * SmsSettings is a TENANT-WIDE singleton: exactly one row per tenant keyed
 * on (tenantId, branchId=null). The service deliberately avoids Prisma
 * `upsert` (which rejects the compound-unique `branchId: null`) and instead
 * does findFirst + opportunistic create with P2002 race-recovery.
 *
 * These specs lock:
 *  - every read/write where-clause carries `branchId: null` (tenant scope),
 *  - findByTenant returns the existing row without creating,
 *  - findByTenant creates a default row when none exists,
 *  - findByTenant recovers from a concurrent-create P2002 by re-reading,
 *  - update mutates the existing row via updateMany + re-fetch,
 *  - update creates the row when none exists,
 *  - update recovers from a P2002 create race by updateMany + re-fetch,
 *  - non-P2002 errors propagate (not swallowed).
 */
describe('SmsSettingsService', () => {
  let prisma: MockPrismaClient;
  let svc: SmsSettingsService;

  const tenantId = 't-1';
  const existingRow = {
    id: 'sms-1',
    tenantId,
    branchId: null,
    isEnabled: true,
    smsOnReservationCreated: true,
  } as any;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new SmsSettingsService(prisma as any);
  });

  describe('findByTenant', () => {
    it('returns the existing tenant-default row without creating one', async () => {
      (prisma.smsSettings.findFirst as any).mockResolvedValue(existingRow);

      const result = await svc.findByTenant(tenantId);

      expect(result).toBe(existingRow);
      expect(prisma.smsSettings.create).not.toHaveBeenCalled();
      const where = (prisma.smsSettings.findFirst as any).mock.calls[0][0].where;
      expect(where.tenantId).toBe(tenantId);
      expect(where.branchId).toBeNull();
    });

    it('creates a default row scoped to the tenant when none exists', async () => {
      (prisma.smsSettings.findFirst as any).mockResolvedValue(null);
      const created = { ...existingRow, id: 'sms-new' };
      (prisma.smsSettings.create as any).mockResolvedValue(created);

      const result = await svc.findByTenant(tenantId);

      expect(result).toBe(created);
      const data = (prisma.smsSettings.create as any).mock.calls[0][0].data;
      expect(data.tenantId).toBe(tenantId);
    });

    it('recovers from a concurrent-create P2002 by re-reading the row', async () => {
      // First lookup: empty. create() loses the race -> P2002.
      // Re-read then finds the row the other writer inserted.
      (prisma.smsSettings.findFirst as any)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existingRow);
      (prisma.smsSettings.create as any).mockRejectedValue({ code: 'P2002' });

      const result = await svc.findByTenant(tenantId);

      expect(result).toBe(existingRow);
      expect(prisma.smsSettings.findFirst).toHaveBeenCalledTimes(2);
    });

    it('propagates non-P2002 create errors instead of swallowing them', async () => {
      (prisma.smsSettings.findFirst as any).mockResolvedValue(null);
      (prisma.smsSettings.create as any).mockRejectedValue({ code: 'P2003' });

      await expect(svc.findByTenant(tenantId)).rejects.toMatchObject({
        code: 'P2003',
      });
    });

    it('re-throws P2002 if the re-read still finds nothing (no infinite masking)', async () => {
      (prisma.smsSettings.findFirst as any)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      const err = { code: 'P2002' };
      (prisma.smsSettings.create as any).mockRejectedValue(err);

      await expect(svc.findByTenant(tenantId)).rejects.toBe(err);
    });
  });

  describe('update', () => {
    const dto = { isEnabled: false, smsOnOrderReady: true } as any;

    it('updates the existing tenant row via updateMany and returns the re-fetched row', async () => {
      (prisma.smsSettings.findFirst as any).mockResolvedValue(existingRow);
      (prisma.smsSettings.updateMany as any).mockResolvedValue({ count: 1 });
      const refetched = { ...existingRow, isEnabled: false };
      (prisma.smsSettings.findFirstOrThrow as any).mockResolvedValue(refetched);

      const result = await svc.update(tenantId, dto);

      expect(result).toBe(refetched);
      const updateCall = (prisma.smsSettings.updateMany as any).mock.calls[0][0];
      expect(updateCall.where.tenantId).toBe(tenantId);
      expect(updateCall.where.branchId).toBeNull();
      expect(updateCall.data).toBe(dto);
      expect(prisma.smsSettings.create).not.toHaveBeenCalled();
    });

    it('creates the row (carrying the dto) when none exists yet', async () => {
      (prisma.smsSettings.findFirst as any).mockResolvedValue(null);
      const created = { id: 'sms-new', tenantId, branchId: null, ...dto };
      (prisma.smsSettings.create as any).mockResolvedValue(created);

      const result = await svc.update(tenantId, dto);

      expect(result).toBe(created);
      const data = (prisma.smsSettings.create as any).mock.calls[0][0].data;
      expect(data.tenantId).toBe(tenantId);
      expect(data.isEnabled).toBe(false);
      expect(data.smsOnOrderReady).toBe(true);
      expect(prisma.smsSettings.updateMany).not.toHaveBeenCalled();
    });

    it('recovers from a create-path P2002 race by updateMany + re-fetch', async () => {
      (prisma.smsSettings.findFirst as any).mockResolvedValue(null);
      (prisma.smsSettings.create as any).mockRejectedValue({ code: 'P2002' });
      (prisma.smsSettings.updateMany as any).mockResolvedValue({ count: 1 });
      const refetched = { ...existingRow, ...dto };
      (prisma.smsSettings.findFirstOrThrow as any).mockResolvedValue(refetched);

      const result = await svc.update(tenantId, dto);

      expect(result).toBe(refetched);
      const recoverWhere = (prisma.smsSettings.updateMany as any).mock
        .calls[0][0].where;
      expect(recoverWhere.tenantId).toBe(tenantId);
      expect(recoverWhere.branchId).toBeNull();
    });

    it('propagates non-P2002 create errors on the update create-path', async () => {
      (prisma.smsSettings.findFirst as any).mockResolvedValue(null);
      (prisma.smsSettings.create as any).mockRejectedValue({ code: 'P2003' });

      await expect(svc.update(tenantId, dto)).rejects.toMatchObject({
        code: 'P2003',
      });
      expect(prisma.smsSettings.findFirstOrThrow).not.toHaveBeenCalled();
    });
  });
});
