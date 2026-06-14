import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../../common/test/prisma-mock.service';
import { TableAnalyticsService } from './table-analytics.service';

/**
 * Spec for TableAnalyticsService — the per-table utilization roll-up, the
 * summary aggregation (avg/top/bottom/peak), the customer-behaviour
 * estimator, and the current-vs-previous comparison maths. Every assertion
 * pins a concrete computed number; a regression in any of the reductions or
 * rounding rules fails the test.
 */
describe('TableAnalyticsService', () => {
  let prisma: MockPrismaClient;
  let svc: TableAnalyticsService;

  const t = 't-1';
  const b = 'b-1';
  const start = new Date('2026-01-01T00:00:00Z');
  const end = new Date('2026-01-08T00:00:00Z');

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new TableAnalyticsService(prisma as any);
  });

  describe('getTableUtilization', () => {
    it('maps groupBy sums, joins table metadata, and computes revenuePerMinute', async () => {
      (prisma.table.findMany as any).mockResolvedValue([
        { id: 'tbl-1', number: '1', section: 'Patio', capacity: 4 },
      ]);
      (prisma.tableAnalytics.groupBy as any).mockResolvedValue([
        {
          tableId: 'tbl-1',
          _sum: {
            totalOccupiedMinutes: 200,
            totalDiningMinutes: 150,
            totalIdleMinutes: 50,
            totalEmptyMinutes: 100,
            totalSessions: 8,
            ordersCount: 12,
          },
          _avg: {
            avgSessionDuration: 25,
            avgOrderValue: 30,
            utilizationScore: 72,
            revenuePerMinute: 0.5,
          },
        },
      ]);
      (prisma.tableAnalytics.findMany as any).mockResolvedValue([
        {
          tableId: 'tbl-1',
          revenueGenerated: 100,
          peakHours: { 12: 80, 13: 95 },
        },
        {
          tableId: 'tbl-1',
          revenueGenerated: 100, // total revenue 200, merges peak hours
          peakHours: { 13: 5 },
        },
      ]);

      const res = await svc.getTableUtilization(t, b, start, end);

      expect(res.tables).toHaveLength(1);
      const row = res.tables[0];
      expect(row.tableId).toBe('tbl-1');
      expect(row.tableNumber).toBe('1');
      expect(row.section).toBe('Patio');
      expect(row.occupiedMinutes).toBe(200);
      expect(row.revenue).toBe(200); // 100 + 100
      expect(row.utilizationScore).toBe(72);
      // revenuePerMinute = revenue / occupiedMinutes = 200 / 200 = 1
      expect(row.revenuePerMinute).toBe(1);
      // peakHours merged: hour 13 = 95 + 5 = 100
      expect(row.peakHours).toEqual({ 12: 80, 13: 100 });
    });

    it('synthesizes a zeroed row (720 empty minutes) for a table with no analytics', async () => {
      (prisma.table.findMany as any).mockResolvedValue([
        { id: 'tbl-empty', number: '9', section: null, capacity: 2 },
      ]);
      (prisma.tableAnalytics.groupBy as any).mockResolvedValue([]);
      (prisma.tableAnalytics.findMany as any).mockResolvedValue([]);

      const res = await svc.getTableUtilization(t, b, start, end);

      expect(res.tables).toHaveLength(1);
      const row = res.tables[0];
      expect(row.tableId).toBe('tbl-empty');
      expect(row.occupiedMinutes).toBe(0);
      expect(row.emptyMinutes).toBe(720);
      expect(row.utilizationScore).toBe(0);
      expect(row.revenuePerMinute).toBe(0);
    });

    it('sorts tables by utilizationScore desc and builds the summary top/bottom', async () => {
      (prisma.table.findMany as any).mockResolvedValue([
        { id: 'low', number: 'L', section: null, capacity: 4 },
        { id: 'high', number: 'H', section: null, capacity: 4 },
      ]);
      (prisma.tableAnalytics.groupBy as any).mockResolvedValue([
        {
          tableId: 'low',
          _sum: {
            totalOccupiedMinutes: 60,
            totalDiningMinutes: 0,
            totalIdleMinutes: 0,
            totalEmptyMinutes: 0,
            totalSessions: 2,
            ordersCount: 0,
          },
          _avg: {
            utilizationScore: 20,
            avgSessionDuration: null,
            avgOrderValue: null,
            revenuePerMinute: null,
          },
        },
        {
          tableId: 'high',
          _sum: {
            totalOccupiedMinutes: 60,
            totalDiningMinutes: 0,
            totalIdleMinutes: 0,
            totalEmptyMinutes: 0,
            totalSessions: 6,
            ordersCount: 0,
          },
          _avg: {
            utilizationScore: 90,
            avgSessionDuration: null,
            avgOrderValue: null,
            revenuePerMinute: null,
          },
        },
      ]);
      (prisma.tableAnalytics.findMany as any).mockResolvedValue([
        { tableId: 'low', revenueGenerated: 10, peakHours: null },
        { tableId: 'high', revenueGenerated: 90, peakHours: null },
      ]);

      const res = await svc.getTableUtilization(t, b, start, end);

      // sorted desc by utilizationScore
      expect(res.tables.map((x) => x.tableId)).toEqual(['high', 'low']);
      // summary: avg = (20 + 90) / 2 = 55
      expect(res.summary.avgUtilization).toBe(55);
      expect(res.summary.totalTables).toBe(2);
      expect(res.summary.totalRevenue).toBe(100);
      expect(res.summary.totalSessions).toBe(8);
      expect(res.summary.topTable.tableId).toBe('high');
      expect(res.summary.bottomTable.tableId).toBe('low');
      // only "low" (score 20 < 50) is underutilized
      expect(res.summary.underutilizedTables.map((x) => x.tableId)).toEqual([
        'low',
      ]);
    });

    it('returns a zeroed summary when there are no tables at all', async () => {
      (prisma.table.findMany as any).mockResolvedValue([]);
      (prisma.tableAnalytics.groupBy as any).mockResolvedValue([]);
      (prisma.tableAnalytics.findMany as any).mockResolvedValue([]);

      const res = await svc.getTableUtilization(t, b, start, end);

      expect(res.tables).toHaveLength(0);
      expect(res.summary.totalTables).toBe(0);
      expect(res.summary.avgUtilization).toBe(0);
      expect(res.summary.peakHour).toBe(12);
      expect(res.summary.peakOccupancy).toBe(0);
    });
  });

  describe('getCustomerBehavior', () => {
    it('computes idle/dining ratio, party-size estimate, and peak hours', async () => {
      (prisma.tableAnalytics.aggregate as any).mockResolvedValue({
        _avg: {
          avgSessionDuration: 40,
          avgDiningDuration: 30,
          avgIdleDuration: 15,
          avgOrderValue: 22,
        },
        _sum: { totalSessions: 100 },
      });
      // peak hours: hour 19 dominates arrival
      (prisma.tableAnalytics.findMany as any).mockResolvedValue([
        { peakHours: { 12: 10, 19: 40 } },
        { peakHours: { 19: 5 } },
      ]);
      // occupancy groupBy: table tbl-1 capacity 4, count 6 -> party = min(6,4)=4
      (prisma.occupancyRecord.groupBy as any).mockResolvedValue([
        { tableId: 'tbl-1', _count: 6 },
      ]);
      (prisma.table.findMany as any).mockResolvedValue([
        { id: 'tbl-1', capacity: 4 },
      ]);

      const res = await svc.getCustomerBehavior(t, b, start, end);

      expect(res.avgDiningTime).toBe(30);
      expect(res.avgIdleTime).toBe(15);
      // idleToDiningRatio = 15 / 30 = 0.5
      expect(res.idleToDiningRatio).toBe(0.5);
      // avgPartySize = min(6,4)=4 over 1 party -> round(4 * 10)/10 = 4
      expect(res.avgPartySize).toBe(4);
      // peakArrivalHour = the hour with the max merged value (19 -> 45)
      expect(res.peakArrivalHour).toBe(19);
      // peakDepartureHour = min(23, 19 + ceil((30+15)/60)) = min(23, 19+1) = 20
      expect(res.peakDepartureHour).toBe(20);
      expect(res.avgOrderValue).toBe(22);
      // merged arrival distribution
      expect(res.arrivalDistribution).toEqual({ 12: 10, 19: 45 });
    });

    it('uses sensible defaults when there is no behaviour data', async () => {
      (prisma.tableAnalytics.aggregate as any).mockResolvedValue({
        _avg: {
          avgSessionDuration: null,
          avgDiningDuration: null,
          avgIdleDuration: null,
          avgOrderValue: null,
        },
        _sum: { totalSessions: 0 },
      });
      (prisma.tableAnalytics.findMany as any).mockResolvedValue([]);
      (prisma.occupancyRecord.groupBy as any).mockResolvedValue([]);
      (prisma.table.findMany as any).mockResolvedValue([]);

      const res = await svc.getCustomerBehavior(t, b, start, end);

      expect(res.avgDiningTime).toBe(0);
      // avgDiningTime 0 => ratio guarded to 0 (no division by zero)
      expect(res.idleToDiningRatio).toBe(0);
      // no parties => default 2.5
      expect(res.avgPartySize).toBe(2.5);
      // defaults retained when no arrival data
      expect(res.peakArrivalHour).toBe(12);
    });
  });

  describe('getUtilizationTrends', () => {
    it('builds daily trends keyed by date and computes table comparisons + revenueChange', async () => {
      // daily groupBy
      (prisma.tableAnalytics.groupBy as any)
        // 1st call: daily trends
        .mockResolvedValueOnce([
          {
            date: new Date('2026-01-01T00:00:00Z'),
            _avg: { utilizationScore: 60 },
            _sum: { totalSessions: 5 },
          },
        ])
        // 2nd call: current-period comparison groupBy
        .mockResolvedValueOnce([
          { tableId: 'tbl-1', _avg: { utilizationScore: 80 } },
        ])
        // 3rd call: previous-period comparison groupBy
        .mockResolvedValueOnce([
          { tableId: 'tbl-1', _avg: { utilizationScore: 40 } },
        ]);

      (prisma.tableAnalytics.findMany as any)
        // 1st: revenue for daily trend
        .mockResolvedValueOnce([
          { date: new Date('2026-01-01T00:00:00Z'), revenueGenerated: 100 },
        ])
        // 2nd: current revenue for comparison
        .mockResolvedValueOnce([{ tableId: 'tbl-1', revenueGenerated: 200 }])
        // 3rd: previous revenue for comparison
        .mockResolvedValueOnce([{ tableId: 'tbl-1', revenueGenerated: 100 }]);

      (prisma.table.findMany as any).mockResolvedValue([
        { id: 'tbl-1', number: 'A' },
      ]);

      const res = await svc.getUtilizationTrends(t, b, start, end);

      expect(res.trends).toHaveLength(1);
      expect(res.trends[0].avgUtilization).toBe(60);
      expect(res.trends[0].totalRevenue).toBe(100);
      expect(res.trends[0].totalSessions).toBe(5);

      expect(res.tableComparisons).toHaveLength(1);
      const cmp = res.tableComparisons[0];
      expect(cmp.tableId).toBe('tbl-1');
      expect(cmp.tableNumber).toBe('A');
      expect(cmp.currentUtilization).toBe(80);
      expect(cmp.previousUtilization).toBe(40);
      // change = 80 - 40 = 40
      expect(cmp.change).toBe(40);
      // revenueChange = round(((200-100)/100)*1000)/10 = 100 (%)
      expect(cmp.revenueChange).toBe(100);
    });

    it('reports revenueChange 0 when there is no previous revenue (no divide-by-zero)', async () => {
      (prisma.tableAnalytics.groupBy as any)
        .mockResolvedValueOnce([]) // daily trends
        .mockResolvedValueOnce([
          { tableId: 'tbl-1', _avg: { utilizationScore: 50 } },
        ]) // current
        .mockResolvedValueOnce([]); // previous

      (prisma.tableAnalytics.findMany as any)
        .mockResolvedValueOnce([]) // daily revenue
        .mockResolvedValueOnce([{ tableId: 'tbl-1', revenueGenerated: 300 }]) // current revenue
        .mockResolvedValueOnce([]); // previous revenue

      (prisma.table.findMany as any).mockResolvedValue([
        { id: 'tbl-1', number: 'A' },
      ]);

      const res = await svc.getUtilizationTrends(t, b, start, end);

      expect(res.tableComparisons[0].previousRevenue).toBe(0);
      expect(res.tableComparisons[0].revenueChange).toBe(0);
    });
  });

  describe('getUnderutilizedTables', () => {
    it('returns only tables under the threshold', async () => {
      (prisma.table.findMany as any).mockResolvedValue([
        { id: 'a', number: 'A', section: null, capacity: 4 },
        { id: 'c', number: 'C', section: null, capacity: 4 },
      ]);
      (prisma.tableAnalytics.groupBy as any).mockResolvedValue([
        {
          tableId: 'a',
          _sum: {
            totalOccupiedMinutes: 10,
            totalDiningMinutes: 0,
            totalIdleMinutes: 0,
            totalEmptyMinutes: 0,
            totalSessions: 1,
            ordersCount: 0,
          },
          _avg: {
            utilizationScore: 30,
            avgSessionDuration: null,
            avgOrderValue: null,
            revenuePerMinute: null,
          },
        },
        {
          tableId: 'c',
          _sum: {
            totalOccupiedMinutes: 10,
            totalDiningMinutes: 0,
            totalIdleMinutes: 0,
            totalEmptyMinutes: 0,
            totalSessions: 1,
            ordersCount: 0,
          },
          _avg: {
            utilizationScore: 70,
            avgSessionDuration: null,
            avgOrderValue: null,
            revenuePerMinute: null,
          },
        },
      ]);
      (prisma.tableAnalytics.findMany as any).mockResolvedValue([]);

      const res = await svc.getUnderutilizedTables(t, b, 50);

      // only table 'a' (score 30 < 50) qualifies
      expect(res.map((x) => x.tableId)).toEqual(['a']);
    });
  });
});
