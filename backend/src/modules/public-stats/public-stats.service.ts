import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { GeolocationService } from './geolocation.service';
import { TrackViewDto } from './dto/track-view.dto';
import { CreateReviewDto } from './dto/create-review.dto';
import * as crypto from 'crypto';

@Injectable()
export class PublicStatsService {
  private readonly logger = new Logger(PublicStatsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geolocationService: GeolocationService,
  ) {}

  private hashIp(ip: string): string {
    return crypto.createHash('sha256').update(ip).digest('hex').substring(0, 32);
  }

  private parseDeviceType(userAgent: string): string {
    if (!userAgent) return 'unknown';
    const ua = userAgent.toLowerCase();
    if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
      return 'mobile';
    }
    if (ua.includes('tablet') || ua.includes('ipad')) {
      return 'tablet';
    }
    return 'desktop';
  }

  private parseBrowser(userAgent: string): string {
    if (!userAgent) return 'unknown';
    const ua = userAgent.toLowerCase();
    if (ua.includes('chrome') && !ua.includes('edge')) return 'Chrome';
    if (ua.includes('firefox')) return 'Firefox';
    if (ua.includes('safari') && !ua.includes('chrome')) return 'Safari';
    if (ua.includes('edge')) return 'Edge';
    if (ua.includes('opera')) return 'Opera';
    return 'Other';
  }

  async trackPageView(dto: TrackViewDto, ip: string, userAgent: string): Promise<void> {
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
      // Return from cache (updated every 5 minutes)
      const cache = await this.prisma.publicStatsCache.findFirst({
        where: { id: 'main' },
      });

      if (cache) {
        return cache;
      }

      // Fallback: Calculate live stats
      return await this.calculateAndCacheStats();
    } catch (error) {
      this.logger.error(`Failed to get public stats: ${error.message}`);
      // Return default stats if tables don't exist or error occurs
      return this.getDefaultStats();
    }
  }

  private getDefaultStats() {
    return {
      totalViews: 0,
      uniqueVisitors: 0,
      totalReviews: 0,
      averageRating: 4.8,
      totalTenants: 0,
      countryDistribution: {},
      cityDistribution: {},
      viewsToday: 0,
      viewsThisWeek: 0,
      viewsThisMonth: 0,
      lastUpdated: new Date(),
    };
  }

  async submitReview(dto: CreateReviewDto, ip: string) {
    const geoData = await this.geolocationService.lookup(ip);

    // Generate avatar from initials
    const initials = dto.name
      .split(' ')
      .map(n => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();

    return this.prisma.publicReview.create({
      data: {
        name: dto.name,
        email: dto.email,
        restaurant: dto.restaurant,
        rating: dto.rating,
        comment: dto.comment,
        avatar: initials,
        country: geoData?.country,
        city: geoData?.city,
        status: 'PENDING', // Requires approval
      },
    });
  }

  async getApprovedReviews(limit = 10) {
    try {
      return await this.prisma.publicReview.findMany({
        where: { status: 'APPROVED' },
        orderBy: { createdAt: 'desc' },
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

  // Update cache every 5 minutes
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'public-stats-cache-update' })
  async updateStatsCache(): Promise<void> {
    try {
      this.logger.debug('Updating public stats cache...');
      await this.calculateAndCacheStats();
      this.geolocationService.cleanCache();
    } catch (error) {
      this.logger.error(`Failed to update stats cache: ${error.message}`);
    }
  }

  private async calculateAndCacheStats() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalViews,
      uniqueVisitors,
      viewsToday,
      viewsThisWeek,
      viewsThisMonth,
      reviews,
      totalTenants,
      countryStats,
      cityStats,
    ] = await Promise.all([
      // Total views
      this.prisma.pageView.count(),
      // Unique visitors (by ipHash)
      this.prisma.pageView.groupBy({
        by: ['ipHash'],
        _count: true,
      }).then(result => result.length),
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
        where: { status: 'APPROVED' },
        _count: true,
        _avg: { rating: true },
      }),
      // Total active tenants
      this.prisma.tenant.count({ where: { status: 'ACTIVE' } }),
      // Country distribution
      this.prisma.pageView.groupBy({
        by: ['country'],
        _count: true,
        where: { country: { not: null } },
        orderBy: { _count: { country: 'desc' } },
        take: 20,
      }),
      // City distribution
      this.prisma.pageView.groupBy({
        by: ['city'],
        _count: true,
        where: { city: { not: null } },
        orderBy: { _count: { city: 'desc' } },
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
      countryDistribution,
      cityDistribution,
      viewsToday,
      viewsThisWeek,
      viewsThisMonth,
      lastUpdated: now,
    };

    // Upsert cache
    await this.prisma.publicStatsCache.upsert({
      where: { id: 'main' },
      create: {
        id: 'main',
        ...statsData,
      },
      update: statsData,
    });

    return statsData;
  }

  // Admin methods for review moderation
  async getPendingReviews() {
    return this.prisma.publicReview.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approveReview(id: string) {
    return this.prisma.publicReview.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
      },
    });
  }

  async rejectReview(id: string) {
    return this.prisma.publicReview.update({
      where: { id },
      data: { status: 'REJECTED' },
    });
  }
}
