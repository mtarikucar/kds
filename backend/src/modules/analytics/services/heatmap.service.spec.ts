import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../../common/test/prisma-mock.service';
import { HeatmapService } from './heatmap.service';
import { HeatmapMetric, HeatmapGranularity } from '../enums/analytics.enum';

/**
 * Spec for the HeatmapService aggregation/normalization/congestion math.
 *
 * These are the genuinely branchy bits: grid binning of world coords into
 * cells, the normalize-by-positive-min algorithm, hotspot thresholding,
 * the congestion severity score + peak-hour-driven recommendation set, and
 * the granularity → cache-TTL mapping. Every assertion pins an exact
 * computed value so a regression in the maths fails the test.
 */
describe('HeatmapService', () => {
  let prisma: MockPrismaClient;
  let svc: HeatmapService;

  const t = 't-1';
  const b = 'b-1';
  const start = new Date('2026-01-01T00:00:00Z');
  const end = new Date('2026-01-02T00:00:00Z');

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new HeatmapService(prisma as any);
  });

  describe('getOccupancyHeatmap', () => {
    it('bins world coordinates into the right cell and normalizes a 2-value grid to 0..1', async () => {
      // cache miss
      (prisma.analyticsHeatmapCache.findUnique as any).mockResolvedValue(null);
      (prisma.analyticsHeatmapCache.upsert as any).mockResolvedValue({});
      // gridWidth=gridDepth=20, cellSize=1 => offsetX=offsetZ=10
      // cellX = floor(positionX + 10), cellZ = floor(positionZ + 10)
      // Two records at (0,0) -> cell (10,10) appears 3x; one at (1,1) -> cell (11,11) 1x
      (prisma.occupancyRecord.findMany as any).mockResolvedValue([
        { positionX: 0, positionZ: 0, state: 'SITTING' },
        { positionX: 0, positionZ: 0, state: 'SITTING' },
        { positionX: 0, positionZ: 0, state: 'SITTING' },
        { positionX: 1, positionZ: 1, state: 'SITTING' },
      ]);

      const res = await svc.getOccupancyHeatmap(t, b, start, end);

      expect(res.metric).toBe(HeatmapMetric.OCCUPANCY);
      expect(res.granularity).toBe(HeatmapGranularity.HOURLY);
      expect(res.gridWidth).toBe(20);
      expect(res.gridDepth).toBe(20);
      // raw counts: cell[10][10]=3, cell[11][11]=1
      // normalize: max=3, min(positive)=1, range=2
      //   3 -> (3-1)/2 = 1 ; 1 -> (1-1)/2 = 0 ; zeros stay 0
      expect(res.maxValue).toBe(3);
      expect(res.minValue).toBe(1);
      expect(res.data[10][10]).toBe(1);
      expect(res.data[11][11]).toBe(0);
      expect(res.data[0][0]).toBe(0);
    });

    it('returns a cached heatmap (no occupancy query) when an unexpired cache row exists', async () => {
      const future = new Date(Date.now() + 60 * 60 * 1000);
      (prisma.analyticsHeatmapCache.findUnique as any).mockResolvedValue({
        metric: 'OCCUPANCY',
        granularity: 'HOURLY',
        startTime: start,
        endTime: end,
        gridWidth: 5,
        gridDepth: 5,
        cellSize: 1,
        heatmapData: [[0.42]],
        maxValue: 9,
        minValue: 1,
        expiresAt: future,
      });

      const res = await svc.getOccupancyHeatmap(t, b, start, end);

      expect(res.data).toEqual([[0.42]]);
      expect(res.maxValue).toBe(9);
      // cache hit short-circuits before any record fetch
      expect(prisma.occupancyRecord.findMany as any).not.toHaveBeenCalled();
    });

    it('ignores an expired cache row and recomputes from records', async () => {
      const past = new Date(Date.now() - 60 * 1000);
      (prisma.analyticsHeatmapCache.findUnique as any).mockResolvedValue({
        metric: 'OCCUPANCY',
        granularity: 'HOURLY',
        startTime: start,
        endTime: end,
        gridWidth: 5,
        gridDepth: 5,
        cellSize: 1,
        heatmapData: [[0.99]],
        maxValue: 1,
        minValue: 1,
        expiresAt: past,
      });
      (prisma.occupancyRecord.findMany as any).mockResolvedValue([]);
      (prisma.analyticsHeatmapCache.upsert as any).mockResolvedValue({});

      const res = await svc.getOccupancyHeatmap(t, b, start, end);

      // expired => recompute path runs the record fetch
      expect(prisma.occupancyRecord.findMany as any).toHaveBeenCalledTimes(1);
      // empty records => everything zero, min collapses to 0
      expect(res.maxValue).toBe(0);
      expect(res.minValue).toBe(0);
    });

    it('clamps a hostile gridWidth to MAX_GRID_DIMENSION (100)', async () => {
      (prisma.analyticsHeatmapCache.findUnique as any).mockResolvedValue(null);
      (prisma.occupancyRecord.findMany as any).mockResolvedValue([]);
      (prisma.analyticsHeatmapCache.upsert as any).mockResolvedValue({});

      const res = await svc.getOccupancyHeatmap(t, b, start, end, {
        gridWidth: 10000,
        gridDepth: 10000,
      });

      expect(res.gridWidth).toBe(100);
      expect(res.gridDepth).toBe(100);
      // the allocated grid honours the clamp, not the requested 10k
      expect(res.data.length).toBe(100);
      expect(res.data[0].length).toBe(100);
    });

    it('falls back to the default dimension when given a non-finite gridWidth', async () => {
      (prisma.analyticsHeatmapCache.findUnique as any).mockResolvedValue(null);
      (prisma.occupancyRecord.findMany as any).mockResolvedValue([]);
      (prisma.analyticsHeatmapCache.upsert as any).mockResolvedValue({});

      const res = await svc.getOccupancyHeatmap(t, b, start, end, {
        gridWidth: NaN,
        gridDepth: -5,
      });

      // NaN and <1 both fall back to the 20 default
      expect(res.gridWidth).toBe(20);
      expect(res.gridDepth).toBe(20);
    });

    it('scopes both the cache lookup and the record fetch by tenant + branch', async () => {
      (prisma.analyticsHeatmapCache.findUnique as any).mockResolvedValue(null);
      (prisma.occupancyRecord.findMany as any).mockResolvedValue([]);
      (prisma.analyticsHeatmapCache.upsert as any).mockResolvedValue({});

      await svc.getOccupancyHeatmap(t, b, start, end);

      const recWhere = (prisma.occupancyRecord.findMany as any).mock.calls[0][0]
        .where;
      expect(recWhere.tenantId).toBe(t);
      expect(recWhere.branchId).toBe(b);
      // v3 branch-scope: the cache read is a findUnique on the compound key
      // @@unique([tenantId, branchId, startTime, endTime, granularity,
      // metric]) — branchId is the 2nd key element, so a branch-A read can
      // never return branch-B's cached heatmap.
      const cacheWhere = (prisma.analyticsHeatmapCache.findUnique as any).mock
        .calls[0][0].where;
      const compound =
        cacheWhere.tenantId_branchId_startTime_endTime_granularity_metric;
      expect(compound.tenantId).toBe(t);
      expect(compound.branchId).toBe(b);
    });

    it('writes the cache via an upsert keyed on the per-branch compound key', async () => {
      (prisma.analyticsHeatmapCache.findUnique as any).mockResolvedValue(null);
      (prisma.occupancyRecord.findMany as any).mockResolvedValue([]);
      (prisma.analyticsHeatmapCache.upsert as any).mockResolvedValue({});

      await svc.getOccupancyHeatmap(t, b, start, end);

      // v3 branch-scope: with branchId now in the @@unique, the cache
      // write is a single concurrency-safe upsert keyed on the compound —
      // each branch keeps its own row instead of clobbering a sibling's.
      const upsertArgs = (prisma.analyticsHeatmapCache.upsert as any).mock
        .calls[0][0];
      const key =
        upsertArgs.where.tenantId_branchId_startTime_endTime_granularity_metric;
      expect(key.tenantId).toBe(t);
      expect(key.branchId).toBe(b);
      // create payload also carries the branchId for the insert path.
      expect(upsertArgs.create.branchId).toBe(b);
    });
  });

  describe('cache TTL by granularity', () => {
    async function ttlForGranularity(granularity: HeatmapGranularity) {
      // v3 branch-scope: the cache read is now a single findUnique on the
      // compound key (branchId is in the @@unique), and the write is a
      // single upsert — so only ONE cache read happens (no separate
      // existence check).
      (prisma.analyticsHeatmapCache.findUnique as any).mockResolvedValue(null);
      (prisma.occupancyRecord.findMany as any).mockResolvedValue([]);
      (prisma.analyticsHeatmapCache.upsert as any).mockResolvedValue({});

      const before = Date.now();
      await svc.getOccupancyHeatmap(t, b, start, end, { granularity });
      // The TTL lives on the upsert's create payload (expiresAt is only
      // set on insert; an existing row's update also carries it).
      const data = (prisma.analyticsHeatmapCache.upsert as any).mock.calls[0][0]
        .create;
      const hours = (data.expiresAt.getTime() - before) / (60 * 60 * 1000);
      return hours;
    }

    it('HOURLY granularity writes a ~1h TTL', async () => {
      const hours = await ttlForGranularity(HeatmapGranularity.HOURLY);
      expect(hours).toBeGreaterThan(0.9);
      expect(hours).toBeLessThan(1.1);
    });

    it('DAILY granularity writes a ~6h TTL', async () => {
      const hours = await ttlForGranularity(HeatmapGranularity.DAILY);
      expect(hours).toBeGreaterThan(5.9);
      expect(hours).toBeLessThan(6.1);
    });

    it('WEEKLY granularity writes a ~24h TTL', async () => {
      const hours = await ttlForGranularity(HeatmapGranularity.WEEKLY);
      expect(hours).toBeGreaterThan(23.9);
      expect(hours).toBeLessThan(24.1);
    });
  });

  describe('getTrafficHeatmap', () => {
    it('sums personCount per (cellZ,cellX) and drops out-of-bounds cells', async () => {
      (prisma.analyticsHeatmapCache.findUnique as any).mockResolvedValue(null);
      (prisma.analyticsHeatmapCache.upsert as any).mockResolvedValue({});
      (prisma.trafficFlowRecord.findMany as any).mockResolvedValue([
        { cellX: 2, cellZ: 3, personCount: 4 },
        { cellX: 2, cellZ: 3, personCount: 6 }, // same cell -> sums to 10
        { cellX: 99, cellZ: 99, personCount: 7 }, // in 20x20 grid -> out of bounds, dropped
        { cellX: 5, cellZ: 5, personCount: 2 },
      ]);

      const res = await svc.getTrafficHeatmap(t, b, start, end);

      expect(res.metric).toBe(HeatmapMetric.TRAFFIC);
      // raw: [3][2]=10, [5][5]=2, out-of-bounds dropped => max=10
      expect(res.maxValue).toBe(10);
      expect(res.minValue).toBe(2);
      // normalize: range = 10-2 = 8 -> 10 ->1, 2 ->0
      expect(res.data[3][2]).toBe(1);
      expect(res.data[5][5]).toBe(0);
      // dropped cell never written
      expect(res.data[19][19]).toBe(0);
    });
  });

  describe('getDwellTimeHeatmap', () => {
    it('computes a person-weighted average dwell per cell', async () => {
      // cell (4,4): two records weighted by personCount
      //   avgDwellTime 30 x personCount 2 = 60
      //   avgDwellTime 90 x personCount 8 = 720
      //   weighted avg = (60+720)/(2+8) = 780/10 = 78
      (prisma.trafficFlowRecord.findMany as any).mockResolvedValue([
        { cellX: 4, cellZ: 4, avgDwellTime: 30, personCount: 2 },
        { cellX: 4, cellZ: 4, avgDwellTime: 90, personCount: 8 },
      ]);

      const res = await svc.getDwellTimeHeatmap(t, b, start, end);

      expect(res.metric).toBe(HeatmapMetric.DWELL_TIME);
      // single populated cell => max=min=78 => normalized value is 0
      expect(res.maxValue).toBe(78);
      expect(res.minValue).toBe(78);
      expect(res.data[4][4]).toBe(0);
    });

    it('queries only records with a non-null avgDwellTime', async () => {
      (prisma.trafficFlowRecord.findMany as any).mockResolvedValue([]);

      await svc.getDwellTimeHeatmap(t, b, start, end);

      const where = (prisma.trafficFlowRecord.findMany as any).mock.calls[0][0]
        .where;
      expect(where.avgDwellTime).toEqual({ not: null });
    });
  });

  describe('getTrafficFlowPaths', () => {
    it('builds a path with duration in seconds and skips singleton tracks', async () => {
      (prisma.occupancyRecord.findMany as any)
        // distinct tracking ids
        .mockResolvedValueOnce([{ trackingId: 'tk-1' }, { trackingId: 'tk-2' }])
        // points for tk-1 (2 points, 120s apart)
        .mockResolvedValueOnce([
          {
            positionX: 0,
            positionZ: 0,
            timestamp: new Date('2026-01-01T00:00:00Z'),
          },
          {
            positionX: 5,
            positionZ: 5,
            timestamp: new Date('2026-01-01T00:02:00Z'),
          },
        ])
        // points for tk-2 (1 point -> skipped, needs >= 2)
        .mockResolvedValueOnce([
          {
            positionX: 1,
            positionZ: 1,
            timestamp: new Date('2026-01-01T00:00:00Z'),
          },
        ]);

      const res = await svc.getTrafficFlowPaths(t, b, start, end);

      // totalVisitors counts distinct tracking ids, not surviving paths
      expect(res.totalVisitors).toBe(2);
      // only tk-1 yielded a path
      expect(res.paths).toHaveLength(1);
      expect(res.paths[0].trackingId).toBe('tk-1');
      expect(res.paths[0].duration).toBe(120);
      expect(res.paths[0].points).toHaveLength(2);
      // avg dwell over surviving paths
      expect(res.avgDwellTime).toBe(120);
    });

    it('returns zero avgDwellTime when no path survives the >=2-point rule', async () => {
      (prisma.occupancyRecord.findMany as any)
        .mockResolvedValueOnce([{ trackingId: 'tk-1' }])
        .mockResolvedValueOnce([
          {
            positionX: 0,
            positionZ: 0,
            timestamp: new Date('2026-01-01T00:00:00Z'),
          },
        ]);

      const res = await svc.getTrafficFlowPaths(t, b, start, end);

      expect(res.paths).toHaveLength(0);
      expect(res.totalVisitors).toBe(1);
      expect(res.avgDwellTime).toBe(0);
    });
  });

  describe('getCongestionAnalysis', () => {
    it('flags only cells whose severity exceeds 0.5 and sorts by severity desc', async () => {
      // Cell A: 50 persons, dwell 120 -> trafficScore=min(50/50,1)=1,
      //   dwellScore=min(120/120,1)=1 -> severity = 0.6 + 0.4 = 1.0 (flagged)
      // Cell B: 5 persons, dwell 10 -> trafficScore=0.1, dwellScore=0.083 ->
      //   severity = 0.06 + 0.033 = 0.093 (NOT flagged, < 0.5)
      (prisma.trafficFlowRecord.findMany as any).mockResolvedValue([
        {
          cellX: 1,
          cellZ: 1,
          personCount: 50,
          avgDwellTime: 120,
          hourBucket: new Date('2026-01-01T13:00:00'),
        },
        {
          cellX: 9,
          cellZ: 9,
          personCount: 5,
          avgDwellTime: 10,
          hourBucket: new Date('2026-01-01T03:00:00'),
        },
      ]);

      const res = await svc.getCongestionAnalysis(t, b, start, end);

      expect(res.congestionPoints).toHaveLength(1);
      const p = res.congestionPoints[0];
      expect(p.x).toBe(1);
      expect(p.z).toBe(1);
      expect(p.severity).toBeCloseTo(1.0, 5);
      expect(p.avgWaitTime).toBe(120);
      // overallScore = round((1 - totalSeverity/count) * 100) = round((1-1)*100)=0
      expect(res.overallScore).toBe(0);
    });

    it('returns score 100 and no recommendations when nothing is congested', async () => {
      (prisma.trafficFlowRecord.findMany as any).mockResolvedValue([
        {
          cellX: 0,
          cellZ: 0,
          personCount: 1,
          avgDwellTime: 5,
          hourBucket: new Date('2026-01-01T05:00:00'),
        },
      ]);

      const res = await svc.getCongestionAnalysis(t, b, start, end);

      expect(res.congestionPoints).toHaveLength(0);
      expect(res.overallScore).toBe(100);
      expect(res.recommendations).toEqual([]);
    });

    it('adds the lunch-rush recommendation when a flagged cell peaks 12:00-14:00', async () => {
      (prisma.trafficFlowRecord.findMany as any).mockResolvedValue([
        {
          cellX: 2,
          cellZ: 2,
          personCount: 50,
          avgDwellTime: 120,
          hourBucket: new Date('2026-01-01T13:00:00'),
        },
      ]);

      const res = await svc.getCongestionAnalysis(t, b, start, end);

      expect(res.recommendations).toContain(
        'Add staff during lunch rush (12:00-14:00)',
      );
      expect(res.recommendations).toContain(
        'Consider widening high-traffic pathways',
      );
      // dinner-peak rec must NOT appear for a lunch peak
      expect(res.recommendations).not.toContain(
        'Consider reservation-only dining during dinner peak',
      );
    });

    it('adds the dinner-peak recommendation when a flagged cell peaks 18:00-21:00', async () => {
      (prisma.trafficFlowRecord.findMany as any).mockResolvedValue([
        {
          cellX: 3,
          cellZ: 3,
          personCount: 50,
          avgDwellTime: 120,
          hourBucket: new Date('2026-01-01T19:00:00'),
        },
      ]);

      const res = await svc.getCongestionAnalysis(t, b, start, end);

      expect(res.recommendations).toContain(
        'Consider reservation-only dining during dinner peak',
      );
      expect(res.recommendations).not.toContain(
        'Add staff during lunch rush (12:00-14:00)',
      );
    });
  });
});
