import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../common/test/prisma-mock.service';

/**
 * Thin-spec for the UsersService read / reject lookups left untested by
 * users.service.spec (which only exercises findAll filters): findOne,
 * getMyProfile, and the rejectUser tombstone + race branches. Each test
 * fails if the tenant-scoping WHERE, the 404 guard, the email tombstone
 * construction, or the race-loss guard regresses.
 */
describe('UsersService — findOne / getMyProfile / rejectUser', () => {
  let prisma: MockPrismaClient;
  let svc: UsersService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new UsersService(
      prisma as any,
      { get: () => undefined } as any,
      {} as any,
      {
        getForTenant: jest.fn().mockResolvedValue({
          features: {},
          limits: {},
          integrations: {},
          computedAt: new Date(0).toISOString(),
        }),
      } as any,
    );
  });

  describe('findOne', () => {
    it('looks up by the (id, tenantId) compound and returns the row', async () => {
      const row = { id: 'u1', email: 'a@b.c' };
      (prisma.user.findFirst as any).mockResolvedValue(row);
      const result = await svc.findOne('u1', 't1');
      expect(result).toBe(row);
      expect((prisma.user.findFirst as any).mock.calls[0][0].where).toEqual({
        id: 'u1',
        tenantId: 't1',
      });
    });

    it('throws NotFound when no row matches the tenant scope', async () => {
      (prisma.user.findFirst as any).mockResolvedValue(null);
      await expect(svc.findOne('u1', 't1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getMyProfile', () => {
    it('reads the user by id and includes the tenant relation', async () => {
      const row = { id: 'u1', tenant: { id: 't1' } };
      (prisma.user.findUnique as any).mockResolvedValue(row);
      const result = await svc.getMyProfile('u1');
      expect(result).toBe(row);
      const args = (prisma.user.findUnique as any).mock.calls[0][0];
      expect(args.where).toEqual({ id: 'u1' });
      expect(args.select.tenant).toBeDefined();
    });

    it('throws NotFound when the user does not exist', async () => {
      (prisma.user.findUnique as any).mockResolvedValue(null);
      await expect(svc.getMyProfile('ghost')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('rejectUser', () => {
    it('404s when there is no PENDING_APPROVAL user', async () => {
      (prisma.user.findFirst as any).mockResolvedValue(null);
      await expect(svc.rejectUser('u1', 't1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      // pre-check filters on the PENDING_APPROVAL status
      expect((prisma.user.findFirst as any).mock.calls[0][0].where).toEqual({
        id: 'u1',
        tenantId: 't1',
        status: 'PENDING_APPROVAL',
      });
    });

    it('tombstones the email with a +rejected-<id> suffix and flips status to REJECTED', async () => {
      (prisma.user.findFirst as any).mockResolvedValue({
        id: 'u1',
        email: 'spam@evil.com',
      });
      (prisma.user.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.user.findUnique as any).mockResolvedValue({
        id: 'u1',
        status: 'REJECTED',
      });

      await svc.rejectUser('u1', 't1');

      const data = (prisma.user.updateMany as any).mock.calls[0][0].data;
      expect(data.status).toBe('REJECTED');
      expect(data.email).toBe('spam@evil.com+rejected-u1@tombstone.kds');
    });

    it('does NOT double-tombstone an email that is already a tombstone', async () => {
      (prisma.user.findFirst as any).mockResolvedValue({
        id: 'u1',
        email: 'spam@evil.com+rejected-u1@tombstone.kds',
      });
      (prisma.user.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.user.findUnique as any).mockResolvedValue({ id: 'u1' });

      await svc.rejectUser('u1', 't1');

      const data = (prisma.user.updateMany as any).mock.calls[0][0].data;
      // unchanged — no second suffix appended
      expect(data.email).toBe('spam@evil.com+rejected-u1@tombstone.kds');
    });

    it('404s when the atomic claim loses the race (count=0)', async () => {
      (prisma.user.findFirst as any).mockResolvedValue({
        id: 'u1',
        email: 'a@b.c',
      });
      (prisma.user.updateMany as any).mockResolvedValue({ count: 0 });
      await expect(svc.rejectUser('u1', 't1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      // never reaches the post-claim read
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });
});
