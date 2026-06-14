import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../common/test/prisma-mock.service';
import { NotificationType } from './dto/create-notification.dto';

/**
 * Spec for the NotificationsService send-decision branches not covered by
 * the existing race-condition spec: the tenant-fallback branch resolution
 * (and its NotFound terminus), the createAndSend dispatch fork
 * (user vs global vs neither), the markAsRead IDOR guard + upsert key,
 * and the findAll non-expired/OR(userId|isGlobal) read scope.
 */
describe('NotificationsService send/dispatch decisions', () => {
  let prisma: MockPrismaClient;
  let gateway: {
    sendNotificationToUser: jest.Mock;
    broadcastToTenantAcrossBranches: jest.Mock;
  };
  let svc: NotificationsService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    gateway = {
      sendNotificationToUser: jest.fn(),
      broadcastToTenantAcrossBranches: jest.fn(),
    };
    svc = new NotificationsService(prisma as any, gateway as any);
  });

  describe('create / fallback branch resolution', () => {
    it('uses the supplied branchId verbatim, skipping the fallback lookup', async () => {
      (prisma.notification.create as any).mockResolvedValue({ id: 'n-1' });

      await svc.create({
        title: 'T',
        message: 'M',
        type: 'ORDER',
        tenantId: 't1',
        branchId: 'b-explicit',
      });

      expect(prisma.branch.findFirst as any).not.toHaveBeenCalled();
      const data = (prisma.notification.create as any).mock.calls[0][0].data;
      expect(data.branchId).toBe('b-explicit');
    });

    it('resolves the tenant first active branch when no branchId is given', async () => {
      (prisma.branch.findFirst as any).mockResolvedValue({ id: 'b-first' });
      (prisma.notification.create as any).mockResolvedValue({ id: 'n-1' });

      await svc.create({
        title: 'T',
        message: 'M',
        type: 'ORDER',
        tenantId: 't1',
      });

      const branchWhere = (prisma.branch.findFirst as any).mock.calls[0][0];
      expect(branchWhere.where).toEqual({ tenantId: 't1', status: 'active' });
      expect(branchWhere.orderBy).toEqual({ createdAt: 'asc' });
      const data = (prisma.notification.create as any).mock.calls[0][0].data;
      expect(data.branchId).toBe('b-first');
    });

    it('throws NotFound when the tenant has no active branch to scope to', async () => {
      (prisma.branch.findFirst as any).mockResolvedValue(null);

      await expect(
        svc.create({
          title: 'T',
          message: 'M',
          type: 'ORDER',
          tenantId: 't1',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.notification.create as any).not.toHaveBeenCalled();
    });
  });

  describe('createAndSend dispatch fork', () => {
    it('dispatches to a single user when userId is present', async () => {
      (prisma.notification.create as any).mockResolvedValue({
        id: 'n-1',
        userId: 'u-1',
      });

      await svc.createAndSend({
        title: 'T',
        message: 'M',
        type: NotificationType.ORDER,
        tenantId: 't1',
        branchId: 'b1',
        userId: 'u-1',
      } as any);

      expect(gateway.sendNotificationToUser).toHaveBeenCalledTimes(1);
      expect(gateway.sendNotificationToUser).toHaveBeenCalledWith('u-1', {
        id: 'n-1',
        userId: 'u-1',
      });
      expect(gateway.broadcastToTenantAcrossBranches).not.toHaveBeenCalled();
    });

    it('broadcasts across branches when isGlobal and no userId', async () => {
      (prisma.notification.create as any).mockResolvedValue({ id: 'n-1' });

      await svc.createAndSend({
        title: 'T',
        message: 'M',
        type: NotificationType.SYSTEM,
        tenantId: 't1',
        branchId: 'b1',
        isGlobal: true,
      } as any);

      expect(gateway.broadcastToTenantAcrossBranches).toHaveBeenCalledWith(
        't1',
        { id: 'n-1' },
      );
      expect(gateway.sendNotificationToUser).not.toHaveBeenCalled();
    });

    it('persists but does NOT dispatch when neither userId nor isGlobal is set', async () => {
      (prisma.notification.create as any).mockResolvedValue({ id: 'n-1' });

      const out = await svc.createAndSend({
        title: 'T',
        message: 'M',
        type: NotificationType.INFO,
        tenantId: 't1',
        branchId: 'b1',
      } as any);

      // row is still created and returned...
      expect(out).toEqual({ id: 'n-1' });
      // ...but no socket path fired (channel undefined)
      expect(gateway.sendNotificationToUser).not.toHaveBeenCalled();
      expect(gateway.broadcastToTenantAcrossBranches).not.toHaveBeenCalled();
    });

    it('defaults priority to NORMAL and isGlobal to false on the stored row', async () => {
      (prisma.notification.create as any).mockResolvedValue({ id: 'n-1' });

      await svc.createAndSend({
        title: 'T',
        message: 'M',
        type: NotificationType.INFO,
        tenantId: 't1',
        branchId: 'b1',
      } as any);

      const data = (prisma.notification.create as any).mock.calls[0][0].data;
      expect(data.priority).toBe('NORMAL');
      expect(data.isGlobal).toBe(false);
      // no expiresAt provided => undefined (never-expires)
      expect(data.expiresAt).toBeUndefined();
    });

    it('converts an expiresAt string into a Date on the stored row', async () => {
      (prisma.notification.create as any).mockResolvedValue({ id: 'n-1' });

      await svc.createAndSend({
        title: 'T',
        message: 'M',
        type: NotificationType.INFO,
        tenantId: 't1',
        branchId: 'b1',
        expiresAt: '2026-12-31T00:00:00.000Z',
      } as any);

      const data = (prisma.notification.create as any).mock.calls[0][0].data;
      expect(data.expiresAt).toBeInstanceOf(Date);
      expect((data.expiresAt as Date).toISOString()).toBe(
        '2026-12-31T00:00:00.000Z',
      );
    });
  });

  describe('markAsRead IDOR guard', () => {
    it('throws NotFound when the notification is not in (tenant, userId|isGlobal) scope', async () => {
      (prisma.notification.findFirst as any).mockResolvedValue(null);

      await expect(
        svc.markAsRead('n-other-tenant', 'u-1', 't1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.userNotificationRead.upsert as any).not.toHaveBeenCalled();
    });

    it('scopes the lookup to tenant + (userId OR isGlobal) and upserts the read row', async () => {
      (prisma.notification.findFirst as any).mockResolvedValue({ id: 'n-1' });
      (prisma.userNotificationRead.upsert as any).mockResolvedValue({});

      await svc.markAsRead('n-1', 'u-1', 't1');

      const where = (prisma.notification.findFirst as any).mock.calls[0][0]
        .where;
      expect(where.id).toBe('n-1');
      expect(where.tenantId).toBe('t1');
      expect(where.OR).toEqual([{ userId: 'u-1' }, { isGlobal: true }]);

      const upsertArgs = (prisma.userNotificationRead.upsert as any).mock
        .calls[0][0];
      expect(upsertArgs.where).toEqual({
        notificationId_userId: { notificationId: 'n-1', userId: 'u-1' },
      });
      expect(upsertArgs.create).toEqual({
        notificationId: 'n-1',
        userId: 'u-1',
      });
    });
  });

  describe('findAll read scope', () => {
    it('scopes to tenant + (userId OR isGlobal), filters expired, and hydrates readBy', async () => {
      (prisma.notification.findMany as any).mockResolvedValue([]);

      await svc.findAll('t1', 'u-1');

      const args = (prisma.notification.findMany as any).mock.calls[0][0];
      expect(args.where.tenantId).toBe('t1');
      expect(args.where.OR).toEqual([{ userId: 'u-1' }, { isGlobal: true }]);
      // non-expired AND clause (null expiry OR future expiry)
      expect(args.where.AND[0].OR[0]).toEqual({ expiresAt: null });
      expect(args.where.AND[0].OR[1]).toHaveProperty('expiresAt.gt');
      // readBy hydrated only for the requesting user
      expect(args.include.readBy.where).toEqual({ userId: 'u-1' });
      expect(args.take).toBe(50);
    });
  });
});
