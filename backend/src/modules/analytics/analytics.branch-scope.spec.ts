import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../common/test/prisma-mock.service';
import { HeatmapService } from './services/heatmap.service';
import { TableAnalyticsService } from './services/table-analytics.service';
import { InsightsService } from './services/insights.service';

/**
 * Track-1 branch-scope hardening (Task 7).
 *
 * Bug: the heatmap / table-analytics / insights data readers filtered by
 * `tenantId` ONLY. `branchId` was threaded in (and used to build the cache
 * key) but never applied to the data `where`, so a branch-A manager saw
 * aggregated occupancy / traffic / table data from EVERY branch — and that
 * cross-branch result was then cached under branch A's key, poisoning it.
 *
 * These specs lock the invariant: every data query carries BOTH tenantId
 * AND branchId in its `where`.
 */
describe('Analytics services — branch-scoped data fetch', () => {
  const T = 't-1';
  const B = 'b-1';
  const start = new Date('2026-01-01T00:00:00Z');
  const end = new Date('2026-01-02T00:00:00Z');

  let prisma: MockPrismaClient;

  beforeEach(() => {
    prisma = mockPrismaClient();
  });

  describe('HeatmapService', () => {
    let svc: HeatmapService;

    beforeEach(() => {
      svc = new HeatmapService(prisma as any);
      // No cached row so the data path runs.
      (prisma.analyticsHeatmapCache.findFirst as any).mockResolvedValue(null);
    });

    it('getOccupancyHeatmap scopes the occupancyRecord query by branchId', async () => {
      (prisma.occupancyRecord.findMany as any).mockResolvedValue([]);
      await svc.getOccupancyHeatmap(T, B, start, end);
      const where = (prisma.occupancyRecord.findMany as any).mock.calls[0][0]
        .where;
      expect(where.tenantId).toBe(T);
      expect(where.branchId).toBe(B);
    });

    it('getTrafficHeatmap scopes the trafficFlowRecord query by branchId', async () => {
      (prisma.trafficFlowRecord.findMany as any).mockResolvedValue([]);
      await svc.getTrafficHeatmap(T, B, start, end);
      const where = (prisma.trafficFlowRecord.findMany as any).mock.calls[0][0]
        .where;
      expect(where.tenantId).toBe(T);
      expect(where.branchId).toBe(B);
    });

    it('getDwellTimeHeatmap scopes the trafficFlowRecord query by branchId', async () => {
      (prisma.trafficFlowRecord.findMany as any).mockResolvedValue([]);
      await svc.getDwellTimeHeatmap(T, B, start, end);
      const where = (prisma.trafficFlowRecord.findMany as any).mock.calls[0][0]
        .where;
      expect(where.tenantId).toBe(T);
      expect(where.branchId).toBe(B);
    });

    it('getTrafficFlowPaths scopes both occupancyRecord queries by branchId', async () => {
      (prisma.occupancyRecord.findMany as any)
        .mockResolvedValueOnce([{ trackingId: 'trk-1' }])
        .mockResolvedValueOnce([
          { positionX: 0, positionZ: 0, timestamp: start },
          { positionX: 1, positionZ: 1, timestamp: end },
        ]);
      await svc.getTrafficFlowPaths(T, B, start, end);
      const trackingWhere = (prisma.occupancyRecord.findMany as any).mock
        .calls[0][0].where;
      expect(trackingWhere.tenantId).toBe(T);
      expect(trackingWhere.branchId).toBe(B);
      const pointsWhere = (prisma.occupancyRecord.findMany as any).mock
        .calls[1][0].where;
      expect(pointsWhere.tenantId).toBe(T);
      expect(pointsWhere.branchId).toBe(B);
    });

    it('getCongestionAnalysis scopes the trafficFlowRecord query by branchId', async () => {
      (prisma.trafficFlowRecord.findMany as any).mockResolvedValue([]);
      await svc.getCongestionAnalysis(T, B, start, end);
      const where = (prisma.trafficFlowRecord.findMany as any).mock.calls[0][0]
        .where;
      expect(where.tenantId).toBe(T);
      expect(where.branchId).toBe(B);
    });
  });

  describe('TableAnalyticsService', () => {
    let svc: TableAnalyticsService;

    beforeEach(() => {
      svc = new TableAnalyticsService(prisma as any);
      (prisma.table.findMany as any).mockResolvedValue([]);
      (prisma.tableAnalytics.groupBy as any).mockResolvedValue([]);
      (prisma.tableAnalytics.findMany as any).mockResolvedValue([]);
      (prisma.tableAnalytics.aggregate as any).mockResolvedValue({
        _avg: {},
        _sum: {},
      });
      (prisma.occupancyRecord.groupBy as any).mockResolvedValue([]);
    });

    it('getTableUtilization scopes the tableAnalytics groupBy by branchId', async () => {
      await svc.getTableUtilization(T, B, start, end);
      const where = (prisma.tableAnalytics.groupBy as any).mock.calls[0][0]
        .where;
      expect(where.tenantId).toBe(T);
      expect(where.branchId).toBe(B);
      // The `table` lookup must be branch-scoped too.
      const tableWhere = (prisma.table.findMany as any).mock.calls[0][0].where;
      expect(tableWhere.tenantId).toBe(T);
      expect(tableWhere.branchId).toBe(B);
    });

    it('getUtilizationTrends scopes the tableAnalytics groupBy by branchId', async () => {
      await svc.getUtilizationTrends(T, B, start, end);
      const where = (prisma.tableAnalytics.groupBy as any).mock.calls[0][0]
        .where;
      expect(where.tenantId).toBe(T);
      expect(where.branchId).toBe(B);
    });

    it('getCustomerBehavior scopes the tableAnalytics aggregate by branchId', async () => {
      await svc.getCustomerBehavior(T, B, start, end);
      const where = (prisma.tableAnalytics.aggregate as any).mock.calls[0][0]
        .where;
      expect(where.tenantId).toBe(T);
      expect(where.branchId).toBe(B);
      const occWhere = (prisma.occupancyRecord.groupBy as any).mock.calls[0][0]
        .where;
      expect(occWhere.tenantId).toBe(T);
      expect(occWhere.branchId).toBe(B);
    });
  });

  describe('InsightsService', () => {
    let svc: InsightsService;

    beforeEach(() => {
      svc = new InsightsService(prisma as any);
      (prisma.analyticsInsight.findMany as any).mockResolvedValue([]);
      (prisma.analyticsInsight.count as any).mockResolvedValue(0);
    });

    it('getInsights scopes the analyticsInsight query by branchId', async () => {
      await svc.getInsights(T, B);
      const where = (prisma.analyticsInsight.findMany as any).mock.calls[0][0]
        .where;
      expect(where.tenantId).toBe(T);
      expect(where.branchId).toBe(B);
      const countWhere = (prisma.analyticsInsight.count as any).mock.calls[0][0]
        .where;
      expect(countWhere.tenantId).toBe(T);
      expect(countWhere.branchId).toBe(B);
    });

    it('getActionableInsights scopes the analyticsInsight query by branchId', async () => {
      await svc.getActionableInsights(T, B);
      const where = (prisma.analyticsInsight.findMany as any).mock.calls[0][0]
        .where;
      expect(where.tenantId).toBe(T);
      expect(where.branchId).toBe(B);
    });
  });
});
