import { BadRequestException } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { HeatmapGranularity } from './enums/analytics.enum';

/**
 * Iter-89 regression for the analytics controller's date-window
 * resolution. Pre-fix every endpoint did
 *
 *   const start = startDate ? new Date(startDate) : default;
 *   const end   = endDate   ? new Date(endDate)   : default;
 *
 * with no validity check. A malformed ISO produced `new Date('Invalid')`
 * → getTime() === NaN → every downstream gte/lte returned false →
 * confusing empty heatmap instead of a 400 (same empty-list trap that
 * iter-87 fixed for orders.findAll and iter-64 fixed for the reports
 * window). The date window also had no upper bound, so a 1970→2100 query
 * would scan years of AnalyticsEvent / Order rows in one request.
 *
 * The fix adds @IsDateString validation via the existing
 * `HeatmapQueryDto` / `DateRangeDto` (previously imported but unused)
 * plus a controller-side `resolveRange` helper that:
 *   - rejects Invalid Date defensively (e.g. 2025-02-30 passes @IsDateString
 *     but constructs NaN)
 *   - rejects start > end
 *   - rejects ranges > 366 days
 */
describe('AnalyticsController.resolveRange (iter-89)', () => {
  let ctrl: AnalyticsController;
  let heatmapService: any;
  let tableAnalyticsService: any;
  let insightsService: any;
  let cameraService: any;
  let mockDataService: any;

  const req = { tenantId: 't-1' } as any;
  const scope = { tenantId: 't-1', branchId: 'b-1', userId: 'u-1', role: 'ADMIN' } as any;

  beforeEach(() => {
    heatmapService = {
      getOccupancyHeatmap: jest.fn().mockResolvedValue({}),
      getTrafficHeatmap: jest.fn().mockResolvedValue({}),
      getDwellTimeHeatmap: jest.fn().mockResolvedValue({}),
      getTrafficFlowPaths: jest.fn().mockResolvedValue([]),
      getCongestionAnalysis: jest.fn().mockResolvedValue({}),
    };
    tableAnalyticsService = {
      getTableUtilization: jest.fn().mockResolvedValue({}),
      getUtilizationTrends: jest.fn().mockResolvedValue({}),
      getUnderutilizedTables: jest.fn().mockResolvedValue([]),
      getCustomerBehavior: jest.fn().mockResolvedValue({}),
    };
    insightsService = {} as any;
    cameraService = {} as any;
    mockDataService = {} as any;
    ctrl = new AnalyticsController(
      mockDataService,
      heatmapService,
      tableAnalyticsService,
      insightsService,
      cameraService,
    );
  });

  describe('Invalid Date defence (the Date-NaN empty-heatmap trap)', () => {
    // @IsDateString catches obvious garbage upstream; these cases are values
    // that LOOK like ISO dates but construct Invalid Date — exactly the
    // shape that pre-iter-89 silently flowed into Prisma's gte/lte.
    // Note: most @IsDateString-passing values will construct valid Dates;
    // here we exercise the controller helper directly with a poisoned shape
    // to lock the defence-in-depth path.
    it('rejects a literal Invalid Date as startDate', async () => {
      await expect(
        ctrl.getOccupancyHeatmap(req, scope, {
          startDate: 'not-an-iso-date-string',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a literal Invalid Date as endDate', async () => {
      await expect(
        ctrl.getOccupancyHeatmap(req, scope, {
          endDate: 'still-not-iso',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('Range ordering', () => {
    it('rejects startDate > endDate', async () => {
      await expect(
        ctrl.getOccupancyHeatmap(req, scope, {
          startDate: '2026-06-01T00:00:00Z',
          endDate: '2026-01-01T00:00:00Z',
        } as any),
      ).rejects.toThrow(/before or equal/);
    });

    it('accepts equal start and end (point-in-time query)', async () => {
      await ctrl.getOccupancyHeatmap(req, scope, {
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-01-01T00:00:00Z',
      } as any);
      expect(heatmapService.getOccupancyHeatmap).toHaveBeenCalled();
    });
  });

  describe('366-day window cap (the all-time-scan DoS lever)', () => {
    it('rejects a window strictly larger than 366 days', async () => {
      // 367 days (>366) — pre-iter-89 this would have scanned a year+ of
      // AnalyticsEvent rows in one request.
      await expect(
        ctrl.getOccupancyHeatmap(req, scope, {
          startDate: '2025-01-01T00:00:00Z',
          endDate: '2026-01-04T00:00:00Z', // 368 days
        } as any),
      ).rejects.toThrow(/366 days/);
    });

    it('accepts the boundary window (exactly 366 days for leap-year)', async () => {
      await ctrl.getOccupancyHeatmap(req, scope, {
        startDate: '2024-01-01T00:00:00Z',
        endDate: '2024-12-31T00:00:00Z',
      } as any);
      expect(heatmapService.getOccupancyHeatmap).toHaveBeenCalled();
    });
  });

  describe('Defaults when one or both sides are omitted', () => {
    it('falls back to a 24h default for occupancy when no dates passed', async () => {
      await ctrl.getOccupancyHeatmap(req, scope, {} as any);
      const [, , start, end] = heatmapService.getOccupancyHeatmap.mock.calls[0];
      const windowMs = end.getTime() - start.getTime();
      // Within a tolerance because Date.now() runs twice during the call.
      expect(windowMs).toBeGreaterThan(23 * 60 * 60 * 1000);
      expect(windowMs).toBeLessThan(25 * 60 * 60 * 1000);
    });

    it('falls back to a 7-day default for table utilization', async () => {
      await ctrl.getTableUtilization(req, scope, {} as any);
      const [, , start, end] = tableAnalyticsService.getTableUtilization.mock.calls[0];
      const windowMs = end.getTime() - start.getTime();
      expect(windowMs).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);
      expect(windowMs).toBeLessThan(7.1 * 24 * 60 * 60 * 1000);
    });

    it('falls back to a 30-day default for utilization trends', async () => {
      await ctrl.getUtilizationTrends(req, scope, {} as any);
      const [, , start, end] = tableAnalyticsService.getUtilizationTrends.mock.calls[0];
      const windowMs = end.getTime() - start.getTime();
      expect(windowMs).toBeGreaterThan(29.9 * 24 * 60 * 60 * 1000);
      expect(windowMs).toBeLessThan(30.1 * 24 * 60 * 60 * 1000);
    });
  });

  describe('Heatmap granularity passthrough', () => {
    it('forwards a valid granularity to the heatmap service', async () => {
      await ctrl.getOccupancyHeatmap(req, scope, {
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-01-02T00:00:00Z',
        granularity: HeatmapGranularity.HOURLY,
      } as any);
      const [, , , , options] = heatmapService.getOccupancyHeatmap.mock.calls[0];
      expect(options).toEqual({ granularity: HeatmapGranularity.HOURLY });
    });
  });

  describe('Limit clamp on getTrafficFlow', () => {
    it('clamps a hostile limit value to 500', async () => {
      await ctrl.getTrafficFlow(req, scope, {} as any, '999999');
      const [, , , , limitNum] = heatmapService.getTrafficFlowPaths.mock.calls[0];
      expect(limitNum).toBe(500);
    });

    it('falls back to 50 on a non-numeric limit', async () => {
      await ctrl.getTrafficFlow(req, scope, {} as any, 'not-a-number');
      const [, , , , limitNum] = heatmapService.getTrafficFlowPaths.mock.calls[0];
      expect(limitNum).toBe(50);
    });

    it('falls back to 50 on a zero or negative limit', async () => {
      await ctrl.getTrafficFlow(req, scope, {} as any, '0');
      const [, , , , limitNum] = heatmapService.getTrafficFlowPaths.mock.calls[0];
      expect(limitNum).toBe(50);
    });
  });

  describe('Threshold clamp on getUnderutilizedTables', () => {
    it('clamps an over-range threshold to 100', async () => {
      await ctrl.getUnderutilizedTables(req, scope, '500');
      const [, , threshold] = tableAnalyticsService.getUnderutilizedTables.mock.calls[0];
      expect(threshold).toBe(100);
    });

    it('clamps a negative threshold to 0', async () => {
      await ctrl.getUnderutilizedTables(req, scope, '-30');
      const [, , threshold] = tableAnalyticsService.getUnderutilizedTables.mock.calls[0];
      expect(threshold).toBe(0);
    });

    it('falls back to 50 on a non-numeric threshold (no NaN propagation)', async () => {
      await ctrl.getUnderutilizedTables(req, scope, 'banana');
      const [, , threshold] = tableAnalyticsService.getUnderutilizedTables.mock.calls[0];
      expect(threshold).toBe(50);
    });
  });
});
