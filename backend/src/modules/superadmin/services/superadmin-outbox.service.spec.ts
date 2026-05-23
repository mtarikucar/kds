import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SuperAdminOutboxService } from './superadmin-outbox.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

/**
 * Tests for the DLQ readout. The service is the only path ops has to see
 * (and re-queue) outbox events that exhausted the worker's retry budget —
 * so the input-validation and pagination contracts have to be tight.
 */
describe('SuperAdminOutboxService', () => {
  let prisma: MockPrismaClient;
  let svc: SuperAdminOutboxService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new SuperAdminOutboxService(prisma as any);
  });

  describe('listFailed', () => {
    it('returns failed events with no cursor when result fits in one page', async () => {
      prisma.outboxEvent.findMany.mockResolvedValue([
        { id: 'evt-2', type: 'order.created.v1', tenantId: 't1', attempts: 8 },
        { id: 'evt-1', type: 'order.completed.v1', tenantId: 't1', attempts: 8 },
      ] as any);

      const result = await svc.listFailed({ tenantId: 't1', limit: 50 });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
      expect(prisma.outboxEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'failed', tenantId: 't1' },
          take: 51, // limit + 1 to detect hasMore
          orderBy: { id: 'desc' },
        }),
      );
    });

    it('sets nextCursor when more results exist beyond the page', async () => {
      // Worker returns limit+1 to signal "more available".
      prisma.outboxEvent.findMany.mockResolvedValue([
        { id: 'evt-3' }, { id: 'evt-2' }, { id: 'evt-1' },
      ] as any);

      const result = await svc.listFailed({ limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe('evt-2');
    });

    it('clamps limit to [1, 200]', async () => {
      prisma.outboxEvent.findMany.mockResolvedValue([] as any);
      await svc.listFailed({ limit: 9999 });
      expect(prisma.outboxEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 201 }),
      );
    });
  });

  describe('summary', () => {
    it('returns counts grouped by status', async () => {
      prisma.outboxEvent.count
        .mockResolvedValueOnce(5)   // queued
        .mockResolvedValueOnce(1)   // dispatching
        .mockResolvedValueOnce(420) // dispatched
        .mockResolvedValueOnce(3);  // failed

      const result = await svc.summary();

      expect(result).toEqual({ queued: 5, dispatching: 1, dispatched: 420, failed: 3 });
    });
  });

  describe('getEvent', () => {
    it('returns the full row when found', async () => {
      prisma.outboxEvent.findUnique.mockResolvedValue({ id: 'evt-1', payload: { foo: 'bar' } } as any);
      const result = await svc.getEvent('evt-1');
      expect(result.id).toBe('evt-1');
    });

    it('throws NotFoundException when missing', async () => {
      prisma.outboxEvent.findUnique.mockResolvedValue(null);
      await expect(svc.getEvent('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('requeue', () => {
    it('flips status=failed → queued and resets nextAttemptAt to now', async () => {
      prisma.outboxEvent.updateMany.mockResolvedValue({ count: 2 } as any);

      const result = await svc.requeue(['evt-1', 'evt-2']);

      expect(result).toEqual({ requeued: 2, requested: 2 });
      expect(prisma.outboxEvent.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['evt-1', 'evt-2'] }, status: 'failed' },
        data: expect.objectContaining({
          status: 'queued',
          lastError: null,
          nextAttemptAt: expect.any(Date),
        }),
      });
    });

    it('optionally resets attempts to 0 when caller passes resetAttempts', async () => {
      prisma.outboxEvent.updateMany.mockResolvedValue({ count: 1 } as any);
      await svc.requeue(['evt-1'], { resetAttempts: true });
      expect(prisma.outboxEvent.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['evt-1'] }, status: 'failed' },
        data: expect.objectContaining({ attempts: 0 }),
      });
    });

    it('rejects empty arrays so ops cannot accidentally re-queue everything', async () => {
      await expect(svc.requeue([])).rejects.toThrow(BadRequestException);
    });

    it('rejects calls with more than 100 ids to bound blast radius', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => `evt-${i}`);
      await expect(svc.requeue(ids)).rejects.toThrow(BadRequestException);
    });
  });
});
