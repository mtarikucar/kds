import { AnalyticsRetentionService } from "./analytics-retention.service";

/**
 * Nightly CV-telemetry retention sweep. Pins the money-relevant behaviors:
 * batched deletes stop at the first short batch, the per-run cap bounds a
 * huge backlog, the sweep only runs under the advisory lock, and cutoffs
 * honor the env-tunable retention windows.
 */
describe("AnalyticsRetentionService", () => {
  let prisma: any;
  let svc: AnalyticsRetentionService;

  const origFlag = process.env.CAMERA_ANALYTICS_ENABLED;
  afterAll(() => {
    if (origFlag === undefined) delete process.env.CAMERA_ANALYTICS_ENABLED;
    else process.env.CAMERA_ANALYTICS_ENABLED = origFlag;
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    delete process.env.ANALYTICS_OCCUPANCY_RETENTION_DAYS;
    delete process.env.ANALYTICS_TRAFFIC_RETENTION_DAYS;
    // The sweep no-ops when camera analytics is inert; the body-exercising
    // tests need it enabled. A dedicated test flips it off.
    process.env.CAMERA_ANALYTICS_ENABLED = "true";
    prisma = {
      // withAdvisoryLock v2: xact lock inside a $transaction; grant by default
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ locked: true }]),
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      analyticsHeatmapCache: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    svc = new AnalyticsRetentionService(prisma);
  });

  it("deletes in batches and stops at the first short batch", async () => {
    // occupancy: full batch (5000) then short (120) → 2 calls; traffic: 0 → 1 call
    (prisma.$executeRawUnsafe as jest.Mock)
      .mockResolvedValueOnce(5000)
      .mockResolvedValueOnce(120)
      .mockResolvedValueOnce(0);
    await svc.sweep();
    const tables = (prisma.$executeRawUnsafe as jest.Mock).mock.calls.map(
      (c: any[]) => c[0],
    );
    expect(tables.filter((q: string) => q.includes("occupancy_records"))).toHaveLength(2);
    expect(tables.filter((q: string) => q.includes("traffic_flow_records"))).toHaveLength(1);
  });

  it("caps a huge backlog at MAX_BATCHES_PER_RUN per table", async () => {
    (prisma.$executeRawUnsafe as jest.Mock).mockResolvedValue(5000); // never short
    await svc.sweep();
    const occCalls = (prisma.$executeRawUnsafe as jest.Mock).mock.calls.filter(
      (c: any[]) => c[0].includes("occupancy_records"),
    );
    expect(occCalls).toHaveLength(40);
  });

  it("does nothing when the advisory lock is held elsewhere", async () => {
    (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValue([
      { locked: false },
    ]);
    await svc.sweep();
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(prisma.analyticsHeatmapCache.deleteMany).not.toHaveBeenCalled();
  });

  it("no-ops entirely when camera analytics is inert (no lock, no deletes)", async () => {
    process.env.CAMERA_ANALYTICS_ENABLED = "false";
    await svc.sweep();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(prisma.analyticsHeatmapCache.deleteMany).not.toHaveBeenCalled();
  });

  it("honors env-tunable retention windows in the cutoff params", async () => {
    process.env.ANALYTICS_OCCUPANCY_RETENTION_DAYS = "7";
    const before = Date.now();
    await svc.sweep();
    const occCall = (prisma.$executeRawUnsafe as jest.Mock).mock.calls.find(
      (c: any[]) => c[0].includes("occupancy_records"),
    );
    const cutoff: Date = occCall[1];
    const expected = before - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(60_000);
  });

  it("purges expired heatmap-cache rows", async () => {
    (prisma.analyticsHeatmapCache.deleteMany as jest.Mock).mockResolvedValue({
      count: 3,
    });
    await svc.sweep();
    const where = (prisma.analyticsHeatmapCache.deleteMany as jest.Mock).mock
      .calls[0][0].where;
    expect(where.expiresAt.lt).toBeInstanceOf(Date);
  });

  it("ignores a malformed retention env (falls back to the default)", async () => {
    process.env.ANALYTICS_OCCUPANCY_RETENTION_DAYS = "banana";
    const before = Date.now();
    await svc.sweep();
    const occCall = (prisma.$executeRawUnsafe as jest.Mock).mock.calls.find(
      (c: any[]) => c[0].includes("occupancy_records"),
    );
    const cutoff: Date = occCall[1];
    const expected = before - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(60_000);
  });
});
