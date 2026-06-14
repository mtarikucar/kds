import { NotFoundException } from '@nestjs/common';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../common/test/prisma-mock.service';
import { ContactService } from './contact.service';

/**
 * Spec for ContactService — the honeypot accept-and-ignore branch, the
 * real submit path (DB write + admin email), the pagination clamping, and
 * the markAsRead count-based NotFound guard.
 */
describe('ContactService', () => {
  let prisma: MockPrismaClient;
  let mailer: { sendAdminNotification: jest.Mock };
  let svc: ContactService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    mailer = { sendAdminNotification: jest.fn().mockResolvedValue(true) };
    svc = new ContactService(prisma as any, mailer as any);
  });

  const baseDto = {
    name: 'Jane',
    email: 'jane@example.com',
    phone: '5551112233',
    message: 'hello',
  };

  describe('create', () => {
    it('silently accepts a honeypot hit without writing or emailing', async () => {
      const res = await svc.create({ ...baseDto, website: 'http://spam' } as any);

      expect(res.success).toBe(true);
      expect(prisma.contactMessage.create as any).not.toHaveBeenCalled();
      expect(mailer.sendAdminNotification).not.toHaveBeenCalled();
    });

    it('treats a blank/whitespace website as not-a-bot and proceeds', async () => {
      (prisma.contactMessage.create as any).mockResolvedValue({ id: 'm-1' });

      await svc.create({ ...baseDto, website: '   ' } as any);

      expect(prisma.contactMessage.create as any).toHaveBeenCalledTimes(1);
    });

    it('persists the message with status NEW and emails the admin', async () => {
      (prisma.contactMessage.create as any).mockResolvedValue({ id: 'm-1' });

      const res = await svc.create({ ...baseDto } as any);

      const data = (prisma.contactMessage.create as any).mock.calls[0][0].data;
      expect(data.status).toBe('NEW');
      expect(data.email).toBe('jane@example.com');
      expect(mailer.sendAdminNotification).toHaveBeenCalledWith({
        name: 'Jane',
        email: 'jane@example.com',
        phone: '5551112233',
        message: 'hello',
      });
      expect(res.success).toBe(true);
    });

    it('still succeeds (and does not throw) when the admin email fails to send', async () => {
      (prisma.contactMessage.create as any).mockResolvedValue({ id: 'm-1' });
      mailer.sendAdminNotification.mockResolvedValue(false);

      const res = await svc.create({ ...baseDto } as any);

      expect(res.success).toBe(true);
    });
  });

  describe('findAll', () => {
    it('clamps limit to the 1..200 range and computes skip from the clamped page', async () => {
      (prisma.$transaction as any).mockResolvedValue([[], 0]);

      // limit 999 -> clamped to 200; page 3 -> skip = (3-1)*200 = 400
      await svc.findAll(3, 999);

      const findManyArgs = (prisma.contactMessage.findMany as any).mock
        .calls[0][0];
      expect(findManyArgs.take).toBe(200);
      expect(findManyArgs.skip).toBe(400);
    });

    it('floors page to 1 and limit to 1 for non-positive inputs', async () => {
      (prisma.$transaction as any).mockResolvedValue([[], 0]);

      await svc.findAll(0, 0);

      const findManyArgs = (prisma.contactMessage.findMany as any).mock
        .calls[0][0];
      expect(findManyArgs.take).toBe(1);
      expect(findManyArgs.skip).toBe(0);
    });

    it('returns a paginated envelope with correct meta', async () => {
      (prisma.$transaction as any).mockResolvedValue([
        [{ id: 'm-1' }, { id: 'm-2' }],
        42,
      ]);

      const res = await svc.findAll(1, 10);

      expect(res.data).toHaveLength(2);
      expect(res.meta.total).toBe(42);
      expect(res.meta.limit).toBe(10);
      // totalPages = ceil(42/10) = 5
      expect(res.meta.totalPages).toBe(5);
    });
  });

  describe('findOne', () => {
    it('throws NotFound when the message does not exist', async () => {
      (prisma.contactMessage.findUnique as any).mockResolvedValue(null);
      await expect(svc.findOne('x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('markAsRead', () => {
    it('throws NotFound when the updateMany matches zero rows', async () => {
      (prisma.contactMessage.updateMany as any).mockResolvedValue({ count: 0 });
      await expect(svc.markAsRead('x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('marks READ and returns the refreshed row when one row matched', async () => {
      (prisma.contactMessage.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.contactMessage.findUnique as any).mockResolvedValue({
        id: 'm-1',
        status: 'READ',
      });

      const res = await svc.markAsRead('m-1');

      const data = (prisma.contactMessage.updateMany as any).mock.calls[0][0]
        .data;
      expect(data.status).toBe('READ');
      expect(res).toEqual({ id: 'm-1', status: 'READ' });
    });
  });
});
