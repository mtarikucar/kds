import { NotFoundException } from '@nestjs/common';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../../common/test/prisma-mock.service';
import { InsightsService } from './insights.service';
import {
  InsightType,
  InsightSeverity,
  InsightStatus,
} from '../enums/analytics.enum';

/**
 * Spec for InsightsService — the filter→where translation, validity window
 * (validFrom/validUntil), the status-transition branch that sets
 * reviewedAt/implementedAt/dismissedReason, the IDOR-guarded mutate path,
 * the summary group-by → record mapping, and the generateInsights
 * threshold/dedup logic. Concrete assertions throughout.
 */
describe('InsightsService', () => {
  let prisma: MockPrismaClient;
  let svc: InsightsService;

  const t = 't-1';
  const b = 'b-1';

  function dbInsight(over: Record<string, unknown> = {}) {
    return {
      id: 'ins-1',
      type: InsightType.TABLE_UNDERUTILIZATION,
      category: 'REVENUE',
      severity: InsightSeverity.WARNING,
      title: 'x',
      description: 'd',
      recommendation: 'r',
      affectedTableIds: [],
      affectedAreaData: null,
      supportingData: null,
      potentialImpact: null,
      confidenceScore: 0.8,
      status: InsightStatus.NEW,
      reviewedAt: null,
      implementedAt: null,
      dismissedReason: null,
      validFrom: new Date('2026-01-01'),
      validUntil: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      ...over,
    };
  }

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new InsightsService(prisma as any);
  });

  describe('getInsights', () => {
    it('builds a validity-windowed, branch-scoped where and applies optional filters', async () => {
      (prisma.analyticsInsight.findMany as any).mockResolvedValue([dbInsight()]);
      (prisma.analyticsInsight.count as any).mockResolvedValue(1);

      const res = await svc.getInsights(t, b, {
        type: InsightType.TRAFFIC_BOTTLENECK,
        severity: InsightSeverity.CRITICAL,
        limit: 5,
        offset: 10,
      });

      const where = (prisma.analyticsInsight.findMany as any).mock.calls[0][0]
        .where;
      expect(where.tenantId).toBe(t);
      expect(where.branchId).toBe(b);
      expect(where.type).toBe(InsightType.TRAFFIC_BOTTLENECK);
      expect(where.severity).toBe(InsightSeverity.CRITICAL);
      // category/status not supplied => absent keys
      expect(where).not.toHaveProperty('category');
      expect(where).not.toHaveProperty('status');
      // validity window present
      expect(where.validFrom).toHaveProperty('lte');
      expect(where.OR).toEqual([
        { validUntil: null },
        { validUntil: { gte: expect.any(Date) } },
      ]);
      // pagination echoed
      expect(res.limit).toBe(5);
      expect(res.offset).toBe(10);
      expect(res.total).toBe(1);
      // mapToResponseDto coalesces nullable scalar fields to undefined
      expect(res.insights[0].potentialImpact).toBeUndefined();
      // affectedAreaData is a straight (un-coalesced) cast => null passes through
      expect(res.insights[0].affectedAreaData).toBeNull();
    });

    it('defaults to limit 20 / offset 0 when no pagination is supplied', async () => {
      (prisma.analyticsInsight.findMany as any).mockResolvedValue([]);
      (prisma.analyticsInsight.count as any).mockResolvedValue(0);

      const res = await svc.getInsights(t, b);

      const args = (prisma.analyticsInsight.findMany as any).mock.calls[0][0];
      expect(args.take).toBe(20);
      expect(args.skip).toBe(0);
      expect(res.limit).toBe(20);
    });
  });

  describe('getInsightById', () => {
    it('throws NotFound when the insight is not in scope', async () => {
      (prisma.analyticsInsight.findFirst as any).mockResolvedValue(null);
      await expect(svc.getInsightById(t, b, 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('updateInsightStatus', () => {
    it('sets reviewedAt + reviewedBy when transitioning to REVIEWED', async () => {
      (prisma.analyticsInsight.findFirst as any).mockResolvedValue(dbInsight());
      (prisma.analyticsInsight.updateMany as any).mockResolvedValue({
        count: 1,
      });
      (prisma.analyticsInsight.findUnique as any).mockResolvedValue(
        dbInsight({ status: InsightStatus.REVIEWED }),
      );

      await svc.updateInsightStatus(t, b, 'ins-1', 'user-9', {
        status: InsightStatus.REVIEWED,
      } as any);

      const data = (prisma.analyticsInsight.updateMany as any).mock.calls[0][0]
        .data;
      expect(data.status).toBe(InsightStatus.REVIEWED);
      expect(data.reviewedBy).toBe('user-9');
      expect(data.reviewedAt).toBeInstanceOf(Date);
      expect(data).not.toHaveProperty('implementedAt');
    });

    it('sets implementedAt when transitioning to IMPLEMENTED', async () => {
      (prisma.analyticsInsight.findFirst as any).mockResolvedValue(dbInsight());
      (prisma.analyticsInsight.updateMany as any).mockResolvedValue({
        count: 1,
      });
      (prisma.analyticsInsight.findUnique as any).mockResolvedValue(
        dbInsight({ status: InsightStatus.IMPLEMENTED }),
      );

      await svc.updateInsightStatus(t, b, 'ins-1', 'user-9', {
        status: InsightStatus.IMPLEMENTED,
      } as any);

      const data = (prisma.analyticsInsight.updateMany as any).mock.calls[0][0]
        .data;
      expect(data.implementedAt).toBeInstanceOf(Date);
      expect(data).not.toHaveProperty('reviewedAt');
    });

    it('records dismissedReason when transitioning to DISMISSED', async () => {
      (prisma.analyticsInsight.findFirst as any).mockResolvedValue(dbInsight());
      (prisma.analyticsInsight.updateMany as any).mockResolvedValue({
        count: 1,
      });
      (prisma.analyticsInsight.findUnique as any).mockResolvedValue(
        dbInsight({ status: InsightStatus.DISMISSED }),
      );

      await svc.updateInsightStatus(t, b, 'ins-1', 'user-9', {
        status: InsightStatus.DISMISSED,
        dismissedReason: 'not relevant',
      } as any);

      const data = (prisma.analyticsInsight.updateMany as any).mock.calls[0][0]
        .data;
      expect(data.dismissedReason).toBe('not relevant');
    });

    it('scopes the mutate updateMany by tenant + branch (IDOR guard)', async () => {
      (prisma.analyticsInsight.findFirst as any).mockResolvedValue(dbInsight());
      (prisma.analyticsInsight.updateMany as any).mockResolvedValue({
        count: 1,
      });
      (prisma.analyticsInsight.findUnique as any).mockResolvedValue(dbInsight());

      await svc.updateInsightStatus(t, b, 'ins-1', 'user-9', {
        status: InsightStatus.NEW,
      } as any);

      const where = (prisma.analyticsInsight.updateMany as any).mock.calls[0][0]
        .where;
      expect(where).toEqual({ id: 'ins-1', tenantId: t, branchId: b });
    });

    it('throws NotFound when the pre-fetch finds nothing', async () => {
      (prisma.analyticsInsight.findFirst as any).mockResolvedValue(null);
      await expect(
        svc.updateInsightStatus(t, b, 'ins-1', 'u', {
          status: InsightStatus.REVIEWED,
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.analyticsInsight.updateMany as any).not.toHaveBeenCalled();
    });

    it('throws NotFound when the claim updateMany affects zero rows (raced)', async () => {
      (prisma.analyticsInsight.findFirst as any).mockResolvedValue(dbInsight());
      (prisma.analyticsInsight.updateMany as any).mockResolvedValue({
        count: 0,
      });
      await expect(
        svc.updateInsightStatus(t, b, 'ins-1', 'u', {
          status: InsightStatus.REVIEWED,
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getInsightSummary', () => {
    it('folds the three group-bys into keyed count records', async () => {
      (prisma.analyticsInsight.count as any).mockResolvedValue(7);
      (prisma.analyticsInsight.groupBy as any)
        .mockResolvedValueOnce([
          { status: 'NEW', _count: 4 },
          { status: 'DISMISSED', _count: 3 },
        ])
        .mockResolvedValueOnce([
          { severity: 'WARNING', _count: 5 },
          { severity: 'INFO', _count: 2 },
        ])
        .mockResolvedValueOnce([{ category: 'REVENUE', _count: 7 }]);

      const res = await svc.getInsightSummary(t, b);

      expect(res.total).toBe(7);
      expect(res.byStatus).toEqual({ NEW: 4, DISMISSED: 3 });
      expect(res.bySeverity).toEqual({ WARNING: 5, INFO: 2 });
      expect(res.byCategory).toEqual({ REVENUE: 7 });
    });
  });

  describe('getInsightsForTables', () => {
    it('returns only insights whose affectedTableIds intersect the requested ids', async () => {
      (prisma.analyticsInsight.findMany as any).mockResolvedValue([
        dbInsight({ id: 'match', affectedTableIds: ['tbl-2', 'tbl-9'] }),
        dbInsight({ id: 'no-overlap', affectedTableIds: ['tbl-7'] }),
        dbInsight({ id: 'empty', affectedTableIds: [] }),
      ]);

      const res = await svc.getInsightsForTables(t, b, ['tbl-2', 'tbl-3']);

      expect(res.map((x) => x.id)).toEqual(['match']);
    });
  });

  describe('generateInsights', () => {
    it('creates an underutilization insight (WARNING) for a table well below average', async () => {
      // two tables: avg = (90 + 10)/2 = 50; tbl-low at 10 < 50*0.6=30 (under)
      //   and 10 < 50*0.3=15 => WARNING severity
      (prisma.tableAnalytics.groupBy as any).mockResolvedValue([
        {
          tableId: 'tbl-high',
          _avg: { utilizationScore: 90, revenuePerMinute: 2 },
        },
        {
          tableId: 'tbl-low',
          _avg: { utilizationScore: 10, revenuePerMinute: 0.1 },
        },
      ]);
      (prisma.table.findMany as any).mockResolvedValue([
        { id: 'tbl-high', number: 'H' },
        { id: 'tbl-low', number: 'L' },
      ]);
      // no existing insight (dedup miss) for the underutilization branch
      (prisma.analyticsInsight.findFirst as any).mockResolvedValue(null);
      // no traffic congestion
      (prisma.trafficFlowRecord.findMany as any).mockResolvedValue([]);
      (prisma.analyticsInsight.createMany as any).mockResolvedValue({
        count: 1,
      });

      const count = await svc.generateInsights(t, b);

      expect(count).toBe(1);
      const created = (prisma.analyticsInsight.createMany as any).mock
        .calls[0][0].data;
      expect(created).toHaveLength(1);
      expect(created[0].type).toBe(InsightType.TABLE_UNDERUTILIZATION);
      expect(created[0].severity).toBe(InsightSeverity.WARNING);
      expect(created[0].affectedTableIds).toEqual(['tbl-low']);
      expect(created[0].tenantId).toBe(t);
      expect(created[0].branchId).toBe(b);
    });

    it('does not duplicate an underutilization insight that already exists', async () => {
      (prisma.tableAnalytics.groupBy as any).mockResolvedValue([
        { tableId: 'tbl-low', _avg: { utilizationScore: 5, revenuePerMinute: 0 } },
        { tableId: 'tbl-hi', _avg: { utilizationScore: 95, revenuePerMinute: 0 } },
      ]);
      (prisma.table.findMany as any).mockResolvedValue([
        { id: 'tbl-low', number: 'L' },
        { id: 'tbl-hi', number: 'H' },
      ]);
      // dedup HIT => skip
      (prisma.analyticsInsight.findFirst as any).mockResolvedValue({
        id: 'existing',
      });
      (prisma.trafficFlowRecord.findMany as any).mockResolvedValue([]);

      const count = await svc.generateInsights(t, b);

      expect(count).toBe(0);
      expect(prisma.analyticsInsight.createMany as any).not.toHaveBeenCalled();
    });

    it('creates a traffic-bottleneck insight when avg dwell > 90 and persons > 10', async () => {
      (prisma.tableAnalytics.groupBy as any).mockResolvedValue([]);
      (prisma.table.findMany as any).mockResolvedValue([]);
      // single cell, avgDwell = (100+140)/2 = 120 (>90), avgPersons=(12+14)/2=13 (>10)
      (prisma.trafficFlowRecord.findMany as any).mockResolvedValue([
        { cellX: 3, cellZ: 4, personCount: 12, avgDwellTime: 100 },
        { cellX: 3, cellZ: 4, personCount: 14, avgDwellTime: 140 },
      ]);
      (prisma.analyticsInsight.findFirst as any).mockResolvedValue(null);
      (prisma.analyticsInsight.createMany as any).mockResolvedValue({
        count: 1,
      });

      const count = await svc.generateInsights(t, b);

      expect(count).toBe(1);
      const created = (prisma.analyticsInsight.createMany as any).mock
        .calls[0][0].data;
      expect(created[0].type).toBe(InsightType.TRAFFIC_BOTTLENECK);
      // avgDwell 120 is NOT > 120 => INFO (boundary)
      expect(created[0].severity).toBe(InsightSeverity.INFO);
      // grid->world: x*2-10 = 3*2-10 = -4 ; z*2-10 = 4*2-10 = -2
      expect(created[0].affectedAreaData).toMatchObject({ x: -4, z: -2 });
    });

    it('writes nothing when neither threshold is met', async () => {
      (prisma.tableAnalytics.groupBy as any).mockResolvedValue([
        { tableId: 'tbl-1', _avg: { utilizationScore: 80, revenuePerMinute: 1 } },
      ]);
      (prisma.table.findMany as any).mockResolvedValue([
        { id: 'tbl-1', number: '1' },
      ]);
      (prisma.analyticsInsight.findFirst as any).mockResolvedValue(null);
      // dwell below 90 => no bottleneck
      (prisma.trafficFlowRecord.findMany as any).mockResolvedValue([
        { cellX: 1, cellZ: 1, personCount: 20, avgDwellTime: 70 },
      ]);

      const count = await svc.generateInsights(t, b);

      expect(count).toBe(0);
      expect(prisma.analyticsInsight.createMany as any).not.toHaveBeenCalled();
    });
  });

  describe('archiveExpiredInsights', () => {
    it('deletes only expired IMPLEMENTED/DISMISSED rows and returns the count', async () => {
      (prisma.analyticsInsight.deleteMany as any).mockResolvedValue({
        count: 4,
      });

      const n = await svc.archiveExpiredInsights(t);

      expect(n).toBe(4);
      const where = (prisma.analyticsInsight.deleteMany as any).mock.calls[0][0]
        .where;
      expect(where.tenantId).toBe(t);
      expect(where.validUntil).toEqual({ lt: expect.any(Date) });
      expect(where.status).toEqual({
        in: [InsightStatus.IMPLEMENTED, InsightStatus.DISMISSED],
      });
    });
  });
});
