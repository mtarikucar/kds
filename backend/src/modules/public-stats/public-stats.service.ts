import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import { GeolocationService } from "./geolocation.service";
import { TrackViewDto } from "./dto/track-view.dto";
import { CreateReviewDto } from "./dto/create-review.dto";
// v2.8.95 — multi-replica safety. Pre-fix every replica fired its
// own updateStatsCache tick on the same wall-clock, so the
// findFirst → calculateAndCacheStats → upsert sequence raced and
// produced duplicate intermediate counts plus extra Postgres load
// proportional to the replica count.
import { withAdvisoryLock } from "../../common/scheduling/advisory-lock";
import * as crypto from "crypto";

@Injectable()
export class PublicStatsService {
  private readonly logger = new Logger(PublicStatsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geolocationService: GeolocationService,
  ) {}

  private hashIp(ip: string): string {
    // Salt with a server-side secret so a full IPv4 rainbow table (~450GB,
    // already circulating) cannot re-identify visitors from a DB dump of the
    // ipHash column. Production must provide IP_HASH_SALT explicitly.
    //
    // We deliberately do NOT fall back to JWT_SECRET/APP_SECRET in
    // production — rotating either of those (a routine action) would
    // silently re-pseudonymize every historical ipHash, breaking visitor
    // analytics and audit comparability. IP_HASH_SALT must be its own
    // value with its own rotation cadence.
    const inProd = process.env.NODE_ENV === "production";
    if (inProd && !process.env.IP_HASH_SALT) {
      throw new Error(
        "IP_HASH_SALT must be configured in production (do not reuse JWT_SECRET/APP_SECRET)",
      );
    }
    const salt = inProd
      ? process.env.IP_HASH_SALT!
      : (process.env.IP_HASH_SALT ?? "dev-fallback-salt");
    return crypto
      .createHash("sha256")
      .update(`${salt}:${ip}`)
      .digest("hex")
      .substring(0, 32);
  }

  private parseDeviceType(userAgent: string): string {
    if (!userAgent) return "unknown";
    const ua = userAgent.toLowerCase();
    if (
      ua.includes("mobile") ||
      ua.includes("android") ||
      ua.includes("iphone")
    ) {
      return "mobile";
    }
    if (ua.includes("tablet") || ua.includes("ipad")) {
      return "tablet";
    }
    return "desktop";
  }

  private parseBrowser(userAgent: string): string {
    if (!userAgent) return "unknown";
    const ua = userAgent.toLowerCase();
    if (ua.includes("chrome") && !ua.includes("edge")) return "Chrome";
    if (ua.includes("firefox")) return "Firefox";
    if (ua.includes("safari") && !ua.includes("chrome")) return "Safari";
    if (ua.includes("edge")) return "Edge";
    if (ua.includes("opera")) return "Opera";
    return "Other";
  }

  async trackPageView(
    dto: TrackViewDto,
    ip: string,
    userAgent: string,
  ): Promise<void> {
    try {
      const geoData = await this.geolocationService.lookup(ip);
      const ipHash = this.hashIp(ip);

      await this.prisma.pageView.create({
        data: {
          page: dto.page,
          path: dto.path,
          referrer: dto.referrer,
          sessionId: dto.sessionId,
          userAgent,
          ipHash,
          country: geoData?.country,
          countryCode: geoData?.countryCode,
          city: geoData?.city,
          region: geoData?.region,
          deviceType: this.parseDeviceType(userAgent),
          browser: this.parseBrowser(userAgent),
        },
      });
    } catch (error) {
      this.logger.error(`Failed to track page view: ${error.message}`);
    }
  }

  async getPublicStats() {
    try {
      const cache = await this.prisma.publicStatsCache.findFirst({
        where: { id: "main" },
      });
      const raw = cache ?? (await this.calculateAndCacheStats());
      return this.toPublicView(raw);
    } catch (error) {
      this.logger.error(`Failed to get public stats: ${error.message}`);
      return this.toPublicView(this.getDefaultStats());
    }
  }

  /**
   * Strip competitively-sensitive numbers from the cache row before serving
   * over the unauthenticated endpoint. Per-tenant revenue / order counts are
   * computed and cached for internal analytics, but the public endpoint
   * should only show vanity metrics a competitor cannot use to derive GMV
   * run-rate or week-over-week order volume. totalRevenue is hidden entirely;
   * totalOrders is rounded down to the nearest 1,000 for display.
   */
  private toPublicView(raw: any) {
    const totalOrdersRounded = raw.totalOrders
      ? Math.floor(raw.totalOrders / 1000) * 1000
      : 0;
    return {
      totalViews: raw.totalViews ?? 0,
      uniqueVisitors: raw.uniqueVisitors ?? 0,
      totalReviews: raw.totalReviews ?? 0,
      averageRating: raw.averageRating ?? 0,
      totalTenants: raw.totalTenants ?? 0,
      totalOrders: totalOrdersRounded,
      countryDistribution: raw.countryDistribution ?? {},
      cityDistribution: raw.cityDistribution ?? {},
      viewsToday: raw.viewsToday ?? 0,
      viewsThisWeek: raw.viewsThisWeek ?? 0,
      viewsThisMonth: raw.viewsThisMonth ?? 0,
      lastUpdated: raw.lastUpdated ?? new Date(),
    };
  }

  private getDefaultStats() {
    // All zeros on cold-start — the UI is responsible for suppressing
    // misleading values (e.g. hide the rating block when there are no
    // reviews yet). Previously this shipped a hard-coded 4.8 which was
    // an obvious consumer-deception / legal risk.
    return {
      totalViews: 0,
      uniqueVisitors: 0,
      totalReviews: 0,
      averageRating: 0,
      totalTenants: 0,
      totalOrders: 0,
      totalRevenue: 0,
      countryDistribution: {},
      cityDistribution: {},
      viewsToday: 0,
      viewsThisWeek: 0,
      viewsThisMonth: 0,
      lastUpdated: new Date(),
    };
  }

  /**
   * Strip HTML tags from public, display-only review text (defense-in-depth
   * stored-XSS guard). We strip markup rather than entity-escape so legitimate
   * punctuation (O'Brien & Sons) survives — the same reason the global
   * input-sanitizer middleware was removed (it mangled apostrophes/OAuth codes).
   * The reviews surface in the moderation UI (PENDING) and publicly (APPROVED).
   */
  private stripTags(v: string | undefined): string | undefined {
    if (v == null) return v;
    return v
      // Drop <script>/<style> blocks wholesale so no inert-but-ugly inner
      // text (e.g. "alert(1)") survives, then strip any remaining tags.
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<[^>]*>/g, "")
      .trim();
  }

  async submitReview(dto: CreateReviewDto, ip: string) {
    const geoData = await this.geolocationService.lookup(ip);

    const name = this.stripTags(dto.name) ?? "";
    const restaurant = this.stripTags(dto.restaurant);
    const comment = this.stripTags(dto.comment);

    // Generate avatar from initials (derived from the sanitized name)
    const initials = name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .substring(0, 2)
      .toUpperCase();

    return this.prisma.publicReview.create({
      data: {
        name,
        email: dto.email,
        restaurant,
        rating: dto.rating,
        comment,
        avatar: initials,
        country: geoData?.country,
        city: geoData?.city,
        status: "PENDING", // Requires approval
      },
    });
  }

  async getApprovedReviews(limit = 10) {
    try {
      return await this.prisma.publicReview.findMany({
        where: { status: "APPROVED" },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          name: true,
          restaurant: true,
          rating: true,
          comment: true,
          avatar: true,
          isVerified: true,
          createdAt: true,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to get approved reviews: ${error.message}`);
      // Return empty array if table doesn't exist
      return [];
    }
  }

  // Update cache every 5 minutes — advisory-lock guarded so only one
  // replica actually computes per tick. Loser silently skips.
  @Cron(CronExpression.EVERY_5_MINUTES, { name: "public-stats-cache-update" })
  async updateStatsCache(): Promise<void> {
    await withAdvisoryLock(
      this.prisma,
      "public-stats-cache-update",
      async () => {
        try {
          this.logger.debug("Updating public stats cache...");
          await this.calculateAndCacheStats();
          this.geolocationService.cleanCache();
        } catch (error: any) {
          this.logger.error(`Failed to update stats cache: ${error.message}`);
        }
      },
      this.logger,
    );
  }

  private async calculateAndCacheStats() {
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    // ISO/TR week starts Monday. getDay() returns Sunday=0..Saturday=6,
    // so Sunday must roll back 6 days, everything else (dayOfWeek - 1).
    // The previous calculation rolled back to Sunday, which made the
    // "this week" counter reset a day early and mis-aligned the WoW
    // comparisons used by the marketing dashboard.
    const dayOfWeek = startOfToday.getDay();
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfToday.getDate() - daysSinceMonday);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalViews,
      uniqueVisitors,
      viewsToday,
      viewsThisWeek,
      viewsThisMonth,
      reviews,
      totalTenants,
      orderStats,
      countryStats,
      cityStats,
    ] = await Promise.all([
      // Total views
      this.prisma.pageView.count(),
      // Unique visitors — `COUNT(DISTINCT ipHash)` is computed in the DB
      // and returns a single integer. The previous `groupBy(['ipHash'])`
      // path materialised every distinct hash into a JS array just to
      // call .length on it, which doesn't scale past a few hundred
      // thousand rows.
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(DISTINCT "ipHash")::bigint AS count FROM "page_views"
      `.then((rows) => Number(rows[0]?.count ?? 0)),
      // Views today
      this.prisma.pageView.count({
        where: { createdAt: { gte: startOfToday } },
      }),
      // Views this week
      this.prisma.pageView.count({
        where: { createdAt: { gte: startOfWeek } },
      }),
      // Views this month
      this.prisma.pageView.count({
        where: { createdAt: { gte: startOfMonth } },
      }),
      // Reviews stats
      this.prisma.publicReview.aggregate({
        where: { status: "APPROVED" },
        _count: true,
        _avg: { rating: true },
      }),
      // Total active tenants
      this.prisma.tenant.count({ where: { status: "ACTIVE" } }),
      // Total orders and revenue (completed orders)
      this.prisma.order.aggregate({
        where: { status: { in: ["PAID", "SERVED", "READY"] } },
        _count: true,
        _sum: { finalAmount: true },
      }),
      // Country distribution
      this.prisma.pageView.groupBy({
        by: ["country"],
        _count: true,
        where: { country: { not: null } },
        orderBy: { _count: { country: "desc" } },
        take: 20,
      }),
      // City distribution
      this.prisma.pageView.groupBy({
        by: ["city"],
        _count: true,
        where: { city: { not: null } },
        orderBy: { _count: { city: "desc" } },
        take: 20,
      }),
    ]);

    // Transform country/city stats to objects
    const countryDistribution: Record<string, number> = {};
    for (const stat of countryStats) {
      if (stat.country) {
        countryDistribution[stat.country] = stat._count;
      }
    }

    const cityDistribution: Record<string, number> = {};
    for (const stat of cityStats) {
      if (stat.city) {
        cityDistribution[stat.city] = stat._count;
      }
    }

    const statsData = {
      totalViews,
      uniqueVisitors,
      totalReviews: reviews._count || 0,
      averageRating: reviews._avg?.rating || 0,
      totalTenants,
      totalOrders: orderStats._count || 0,
      totalRevenue: Number(orderStats._sum?.finalAmount || 0),
      countryDistribution,
      cityDistribution,
      viewsToday,
      viewsThisWeek,
      viewsThisMonth,
      lastUpdated: now,
    };

    // Upsert cache
    await this.prisma.publicStatsCache.upsert({
      where: { id: "main" },
      create: {
        id: "main",
        ...statsData,
      },
      update: statsData,
    });

    return statsData;
  }

  // Admin methods for review moderation
  async getPendingReviews() {
    return this.prisma.publicReview.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
  }

  async approveReview(id: string) {
    return this.prisma.publicReview.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedAt: new Date(),
      },
    });
  }

  async rejectReview(id: string) {
    return this.prisma.publicReview.update({
      where: { id },
      data: { status: "REJECTED" },
    });
  }
}
