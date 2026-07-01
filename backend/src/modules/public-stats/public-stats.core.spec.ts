import * as crypto from "crypto";
import { PublicStatsService } from "./public-stats.service";

/**
 * Core public-stats behaviours beyond review sanitization:
 *   - trackPageView: PRIVACY — the row stores a salted hash of the IP, never
 *     the raw IP; UA is parsed into device/browser; geo is denormalised in.
 *   - trackPageView swallows errors (best-effort telemetry, never 500s a visitor).
 *   - calculateAndCacheStats (reached via getPublicStats on a cold cache):
 *     correct createdAt date buckets for today/week/month, distinct-visitor
 *     count, top-country/top-city breakdowns, and the cache upsert payload.
 *   - toPublicView: revenue hidden, totalOrders floored to the nearest 1,000,
 *     empty/cold data zeroes out.
 *   - getPublicStats: serves an existing cache row; degrades to all-zero
 *     defaults when the DB throws.
 */
describe("PublicStatsService core logic", () => {
  function build() {
    const prisma: any = {
      pageView: {
        create: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      publicReview: {
        aggregate: jest.fn().mockResolvedValue({ _count: 0, _avg: { rating: null } }),
      },
      tenant: { count: jest.fn().mockResolvedValue(0) },
      order: {
        aggregate: jest.fn().mockResolvedValue({ _count: 0, _sum: { finalAmount: null } }),
      },
      publicStatsCache: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ count: 0n }]),
    };
    const geo: any = { lookup: jest.fn().mockResolvedValue(null), cleanCache: jest.fn() };
    const svc = new PublicStatsService(prisma, geo);
    return { svc, prisma, geo };
  }

  // ---- trackPageView: privacy + enrichment -------------------------------

  describe("trackPageView privacy", () => {
    it("stores a salted hash of the IP, NOT the raw IP", async () => {
      const { svc, prisma, geo } = build();
      geo.lookup.mockResolvedValue(null);
      const rawIp = "203.0.113.7";

      await svc.trackPageView(
        { page: "landing", path: "/" } as any,
        rawIp,
        "Mozilla/5.0",
      );

      const data = prisma.pageView.create.mock.calls[0][0].data;
      expect(data.ipHash).toBeDefined();
      expect(data.ipHash).not.toBe(rawIp);
      expect(JSON.stringify(data)).not.toContain(rawIp);
      // No raw-IP column on the row at all.
      expect((data as any).ip).toBeUndefined();
    });

    it("produces the deterministic sha256(salt:ip)[:32] hash", async () => {
      const { svc, prisma } = build();
      const rawIp = "203.0.113.7";
      // dev fallback salt — matches the service when IP_HASH_SALT is unset.
      const expected = crypto
        .createHash("sha256")
        .update(`dev-fallback-salt:${rawIp}`)
        .digest("hex")
        .substring(0, 32);

      await svc.trackPageView({ page: "landing", path: "/" } as any, rawIp, "ua");

      const data = prisma.pageView.create.mock.calls[0][0].data;
      expect(data.ipHash).toBe(expected);
      expect(data.ipHash).toHaveLength(32);
    });

    it("denormalises geo + parses device/browser from the user-agent", async () => {
      const { svc, prisma, geo } = build();
      geo.lookup.mockResolvedValue({
        country: "Turkey",
        countryCode: "TR",
        city: "Istanbul",
        region: "34",
      });

      await svc.trackPageView(
        { page: "landing", path: "/", referrer: "g.com", sessionId: "s1" } as any,
        "8.8.8.8",
        "Mozilla/5.0 (iPhone) Safari",
      );

      const data = prisma.pageView.create.mock.calls[0][0].data;
      expect(data.country).toBe("Turkey");
      expect(data.city).toBe("Istanbul");
      expect(data.deviceType).toBe("mobile"); // iphone -> mobile
      expect(data.browser).toBe("Safari");
      expect(data.referrer).toBe("g.com");
      expect(data.sessionId).toBe("s1");
    });

    it("swallows DB errors (best-effort telemetry never throws)", async () => {
      const { svc, prisma } = build();
      prisma.pageView.create.mockRejectedValue(new Error("db down"));

      await expect(
        svc.trackPageView({ page: "p", path: "/" } as any, "8.8.8.8", "ua"),
      ).resolves.toBeUndefined();
    });
  });

  // ---- IP hashing salt policy --------------------------------------------

  describe("hashIp salt policy", () => {
    const prev = process.env.NODE_ENV;
    const prevSalt = process.env.IP_HASH_SALT;
    afterEach(() => {
      process.env.NODE_ENV = prev;
      if (prevSalt === undefined) delete process.env.IP_HASH_SALT;
      else process.env.IP_HASH_SALT = prevSalt;
    });

    it("refuses to hash in production without IP_HASH_SALT", async () => {
      const { svc, prisma } = build();
      process.env.NODE_ENV = "production";
      delete process.env.IP_HASH_SALT;

      await svc.trackPageView({ page: "p", path: "/" } as any, "8.8.8.8", "ua");

      // The throw is swallowed by trackPageView's try/catch, so the side
      // effect we can observe is that NO row was written.
      expect(prisma.pageView.create).not.toHaveBeenCalled();
    });

    it("uses the configured production salt (different output than dev salt)", async () => {
      const { svc, prisma } = build();
      process.env.NODE_ENV = "production";
      process.env.IP_HASH_SALT = "prod-secret";
      const devHash = crypto
        .createHash("sha256")
        .update(`dev-fallback-salt:8.8.8.8`)
        .digest("hex")
        .substring(0, 32);

      await svc.trackPageView({ page: "p", path: "/" } as any, "8.8.8.8", "ua");

      const data = prisma.pageView.create.mock.calls[0][0].data;
      expect(data.ipHash).not.toBe(devHash);
    });
  });

  // ---- calculateAndCacheStats via getPublicStats (cold cache) ------------

  describe("live-stats aggregation (cold cache)", () => {
    it("computes today/week/month buckets from createdAt and distinct visitors", async () => {
      const { svc, prisma } = build();
      // distinct visitors
      prisma.$queryRaw.mockResolvedValue([{ count: 42n }]);
      // count() is called 5x in order: total, today, week, month
      prisma.pageView.count
        .mockResolvedValueOnce(1000) // totalViews
        .mockResolvedValueOnce(10) // viewsToday
        .mockResolvedValueOnce(70) // viewsThisWeek
        .mockResolvedValueOnce(300); // viewsThisMonth

      const result = await svc.getPublicStats();

      expect(result.totalViews).toBe(1000);
      expect(result.uniqueVisitors).toBe(42);
      expect(result.viewsToday).toBe(10);
      expect(result.viewsThisWeek).toBe(70);
      expect(result.viewsThisMonth).toBe(300);

      // The today/week/month counts must each carry a createdAt >= boundary.
      const calls = prisma.pageView.count.mock.calls;
      const today = calls[1][0].where.createdAt.gte as Date;
      const week = calls[2][0].where.createdAt.gte as Date;
      const month = calls[3][0].where.createdAt.gte as Date;

      // start-of-today: midnight, no time component.
      expect(today.getHours()).toBe(0);
      expect(today.getMinutes()).toBe(0);
      // week boundary is a Monday (ISO week start).
      expect(week.getDay()).toBe(1);
      // week start is on/before today's midnight; month start on/before today.
      expect(week.getTime()).toBeLessThanOrEqual(today.getTime());
      expect(month.getDate()).toBe(1); // first of the month
      // NB: month-start is NOT necessarily <= week-start — when the 1st falls
      // mid-week (e.g. a Wednesday), start-of-month is AFTER the week's Monday.
      // The stable invariant is month-start on/before today.
      expect(month.getTime()).toBeLessThanOrEqual(today.getTime());
    });

    it("builds top-country / top-city breakdowns from groupBy results", async () => {
      const { svc, prisma } = build();
      prisma.pageView.groupBy
        .mockResolvedValueOnce([
          { country: "Turkey", _count: 80 },
          { country: "Germany", _count: 20 },
          { country: null, _count: 5 }, // null bucket is dropped
        ])
        .mockResolvedValueOnce([
          { city: "Istanbul", _count: 50 },
          { city: "Berlin", _count: 15 },
        ]);

      const result = await svc.getPublicStats();

      expect(result.countryDistribution).toEqual({ Turkey: 80, Germany: 20 });
      expect(result.cityDistribution).toEqual({ Istanbul: 50, Berlin: 15 });

      // Provider is asked for the TOP 20 ordered by count desc.
      const countryCall = prisma.pageView.groupBy.mock.calls[0][0];
      expect(countryCall.take).toBe(20);
      expect(countryCall.orderBy._count.country).toBe("desc");
    });

    it("hides revenue and floors totalOrders to the nearest 1,000", async () => {
      const { svc, prisma } = build();
      prisma.order.aggregate.mockResolvedValue({
        _count: 12345,
        _sum: { finalAmount: 987654.32 },
      });

      const result: any = await svc.getPublicStats();

      expect(result.totalOrders).toBe(12000); // floor(12345/1000)*1000
      expect(result).not.toHaveProperty("totalRevenue"); // never served publicly
    });

    it("counts only completed orders and active tenants", async () => {
      const { svc, prisma } = build();
      await svc.getPublicStats();

      const orderWhere = prisma.order.aggregate.mock.calls[0][0].where;
      expect(orderWhere.status.in).toEqual(["PAID", "SERVED", "READY"]);
      const tenantWhere = prisma.tenant.count.mock.calls[0][0].where;
      expect(tenantWhere.status).toBe("ACTIVE");
    });

    it("aggregates rating only over APPROVED reviews, defaulting null avg to 0", async () => {
      const { svc, prisma } = build();
      prisma.publicReview.aggregate.mockResolvedValue({
        _count: 3,
        _avg: { rating: null },
      });

      const result = await svc.getPublicStats();

      expect(prisma.publicReview.aggregate.mock.calls[0][0].where.status).toBe(
        "APPROVED",
      );
      expect(result.totalReviews).toBe(3);
      expect(result.averageRating).toBe(0);
    });

    it("persists the computed stats into the cache row keyed 'main'", async () => {
      const { svc, prisma } = build();
      prisma.pageView.count.mockResolvedValue(7);

      await svc.getPublicStats();

      expect(prisma.publicStatsCache.upsert).toHaveBeenCalledTimes(1);
      const args = prisma.publicStatsCache.upsert.mock.calls[0][0];
      expect(args.where.id).toBe("main");
      expect(args.create.id).toBe("main");
      expect(args.update.totalViews).toBe(7);
    });

    it("zeroes everything when there is no data", async () => {
      const { svc } = build(); // all mocks return empty/0/null

      const result = await svc.getPublicStats();

      expect(result).toMatchObject({
        totalViews: 0,
        uniqueVisitors: 0,
        totalReviews: 0,
        averageRating: 0,
        totalTenants: 0,
        totalOrders: 0,
        viewsToday: 0,
        viewsThisWeek: 0,
        viewsThisMonth: 0,
        countryDistribution: {},
        cityDistribution: {},
      });
    });
  });

  // ---- getPublicStats: cache-hit + degraded paths ------------------------

  describe("getPublicStats serving", () => {
    it("serves an existing cache row WITHOUT recomputing", async () => {
      const { svc, prisma } = build();
      prisma.publicStatsCache.findFirst.mockResolvedValue({
        totalViews: 500,
        uniqueVisitors: 100,
        totalReviews: 4,
        averageRating: 4.2,
        totalTenants: 9,
        totalOrders: 5678,
        totalRevenue: 99999,
        countryDistribution: { Turkey: 5 },
        cityDistribution: { Istanbul: 3 },
        viewsToday: 1,
        viewsThisWeek: 2,
        viewsThisMonth: 3,
        lastUpdated: new Date("2026-01-01"),
      });

      const result: any = await svc.getPublicStats();

      expect(prisma.pageView.count).not.toHaveBeenCalled(); // no recompute
      expect(result.totalViews).toBe(500);
      expect(result.totalOrders).toBe(5000); // still floored on the public view
      expect(result).not.toHaveProperty("totalRevenue"); // still stripped
    });

    it("degrades to all-zero defaults when the DB throws", async () => {
      const { svc, prisma } = build();
      prisma.publicStatsCache.findFirst.mockRejectedValue(new Error("db down"));

      const result = await svc.getPublicStats();

      expect(result.totalViews).toBe(0);
      expect(result.averageRating).toBe(0); // no fake 4.8
      expect(result.countryDistribution).toEqual({});
    });
  });
});
