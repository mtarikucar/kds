import { BadRequestException } from '@nestjs/common';
import { WasteLogsService } from './waste-logs.service';
import { IngredientMovementsService } from './ingredient-movements.service';

/**
 * Iter-92 regression for the shared date-window guard used by both
 * waste-logs and ingredient-movements list/summary endpoints.
 *
 * Pre-fix both services did
 *
 *   if (filters?.startDate) where.createdAt.gte = new Date(filters.startDate);
 *
 * with no validity check. A non-ISO string produced `Invalid Date`
 * (NaN), every gte/lte returned false, and the call returned a
 * confusing empty list (same iter-87 / iter-89 trap). The window was
 * also unbounded, so a 1970→2100 query could scan years of waste +
 * movement history per request.
 *
 * waste-logs ALSO had no pagination — a chain tenant's full waste
 * history streamed in one response.
 */
describe('stock-management list services — date-window guard (iter-92)', () => {
  describe('WasteLogsService.findAll', () => {
    let prisma: any;
    let service: WasteLogsService;

    beforeEach(() => {
      prisma = {
        wasteLog: {
          findMany: jest.fn().mockResolvedValue([]),
          groupBy: jest.fn().mockResolvedValue([]),
          aggregate: jest.fn().mockResolvedValue({ _sum: { cost: 0 }, _count: 0 }),
        },
      };
      service = new WasteLogsService(prisma);
    });

    it('rejects an Invalid-Date startDate (the NaN empty-list trap)', async () => {
      await expect(
        service.findAll('t-1', { startDate: 'totally-not-an-iso-string' as any }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an Invalid-Date endDate', async () => {
      await expect(
        service.findAll('t-1', { endDate: 'still-not-a-date' as any }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects startDate > endDate', async () => {
      await expect(
        service.findAll('t-1', {
          startDate: '2026-06-01T00:00:00Z',
          endDate: '2026-01-01T00:00:00Z',
        }),
      ).rejects.toThrow(/before or equal/);
    });

    it('rejects a window > 366 days (the all-time-scan DoS lever)', async () => {
      await expect(
        service.findAll('t-1', {
          startDate: '2024-01-01T00:00:00Z',
          endDate: '2025-06-01T00:00:00Z',
        }),
      ).rejects.toThrow(/366 days/);
    });

    it('applies the 500-row default take when no limit is passed', async () => {
      await service.findAll('t-1', {});
      expect(prisma.wasteLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 500, skip: 0 }),
      );
    });

    it('forwards a custom limit / offset', async () => {
      await service.findAll('t-1', { limit: 50, offset: 100 });
      expect(prisma.wasteLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50, skip: 100 }),
      );
    });

    it('accepts a valid window within the cap (passthrough sanity)', async () => {
      await service.findAll('t-1', {
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-06-01T00:00:00Z',
      });
      const call = prisma.wasteLog.findMany.mock.calls[0][0];
      expect(call.where.createdAt.gte).toEqual(new Date('2026-01-01T00:00:00Z'));
      expect(call.where.createdAt.lte).toEqual(new Date('2026-06-01T00:00:00Z'));
    });
  });

  describe('WasteLogsService.getSummary', () => {
    let prisma: any;
    let service: WasteLogsService;

    beforeEach(() => {
      prisma = {
        wasteLog: {
          findMany: jest.fn().mockResolvedValue([]),
          groupBy: jest.fn().mockResolvedValue([]),
          aggregate: jest.fn().mockResolvedValue({ _sum: { cost: 0 }, _count: 0 }),
        },
      };
      service = new WasteLogsService(prisma);
    });

    it('rejects an Invalid-Date startDate in summary too', async () => {
      await expect(
        service.getSummary('t-1', 'totally-not-an-iso-string'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an over-cap window in summary', async () => {
      await expect(
        service.getSummary('t-1', '2024-01-01T00:00:00Z', '2025-06-01T00:00:00Z'),
      ).rejects.toThrow(/366 days/);
    });
  });

  describe('IngredientMovementsService.findAll', () => {
    let prisma: any;
    let service: IngredientMovementsService;

    beforeEach(() => {
      prisma = {
        ingredientMovement: { findMany: jest.fn().mockResolvedValue([]) },
      };
      service = new IngredientMovementsService(prisma);
    });

    it('rejects an Invalid-Date startDate', async () => {
      await expect(
        service.findAll('t-1', { startDate: 'totally-not-an-iso-string' as any }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects start > end', async () => {
      await expect(
        service.findAll('t-1', {
          startDate: '2026-06-01T00:00:00Z',
          endDate: '2026-01-01T00:00:00Z',
        }),
      ).rejects.toThrow(/before or equal/);
    });

    it('rejects an over-cap window', async () => {
      await expect(
        service.findAll('t-1', {
          startDate: '2024-01-01T00:00:00Z',
          endDate: '2025-06-01T00:00:00Z',
        }),
      ).rejects.toThrow(/366 days/);
    });

    it('forwards a valid window', async () => {
      await service.findAll('t-1', {
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-02-01T00:00:00Z',
      });
      const call = prisma.ingredientMovement.findMany.mock.calls[0][0];
      expect(call.where.createdAt.gte).toEqual(new Date('2026-01-01T00:00:00Z'));
      expect(call.where.createdAt.lte).toEqual(new Date('2026-02-01T00:00:00Z'));
    });
  });
});
