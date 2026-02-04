import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  InsightType,
  InsightCategory,
  InsightSeverity,
  InsightStatus,
} from '../enums/analytics.enum';
import {
  InsightFilterDto,
  InsightResponseDto,
  InsightListResponseDto,
  UpdateInsightStatusDto,
} from '../dto';

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get all insights for a tenant with filtering
   */
  async getInsights(
    tenantId: string,
    filters: InsightFilterDto = {}
  ): Promise<InsightListResponseDto> {
    const {
      type,
      category,
      severity,
      status,
      limit = 20,
      offset = 0,
    } = filters;

    const where = {
      tenantId,
      ...(type && { type }),
      ...(category && { category }),
      ...(severity && { severity }),
      ...(status && { status }),
      validFrom: { lte: new Date() },
      OR: [
        { validUntil: null },
        { validUntil: { gte: new Date() } },
      ],
    };

    const [insights, total] = await Promise.all([
      this.prisma.analyticsInsight.findMany({
        where,
        orderBy: [
          { severity: 'desc' },
          { createdAt: 'desc' },
        ],
        skip: offset,
        take: limit,
      }),
      this.prisma.analyticsInsight.count({ where }),
    ]);

    return {
      insights: insights.map(this.mapToResponseDto),
      total,
      limit,
      offset,
    };
  }

  /**
   * Get a single insight by ID
   */
  async getInsightById(tenantId: string, insightId: string): Promise<InsightResponseDto> {
    const insight = await this.prisma.analyticsInsight.findFirst({
      where: {
        id: insightId,
        tenantId,
      },
    });

    if (!insight) {
      throw new NotFoundException(`Insight with ID ${insightId} not found`);
    }

    return this.mapToResponseDto(insight);
  }

  /**
   * Update insight status
   */
  async updateInsightStatus(
    tenantId: string,
    insightId: string,
    userId: string,
    dto: UpdateInsightStatusDto
  ): Promise<InsightResponseDto> {
    const insight = await this.prisma.analyticsInsight.findFirst({
      where: {
        id: insightId,
        tenantId,
      },
    });

    if (!insight) {
      throw new NotFoundException(`Insight with ID ${insightId} not found`);
    }

    const updateData: Record<string, unknown> = {
      status: dto.status,
    };

    if (dto.status === InsightStatus.REVIEWED) {
      updateData.reviewedAt = new Date();
      updateData.reviewedBy = userId;
    } else if (dto.status === InsightStatus.IMPLEMENTED) {
      updateData.implementedAt = new Date();
    } else if (dto.status === InsightStatus.DISMISSED) {
      updateData.dismissedReason = dto.dismissedReason;
    }

    const updated = await this.prisma.analyticsInsight.update({
      where: { id: insightId },
      data: updateData,
    });

    this.logger.log(`Insight ${insightId} status updated to ${dto.status}`);
    return this.mapToResponseDto(updated);
  }

  /**
   * Get insight summary counts by status
   */
  async getInsightSummary(tenantId: string): Promise<{
    total: number;
    byStatus: Record<string, number>;
    bySeverity: Record<string, number>;
    byCategory: Record<string, number>;
  }> {
    const where = {
      tenantId,
      validFrom: { lte: new Date() },
      OR: [
        { validUntil: null },
        { validUntil: { gte: new Date() } },
      ],
    };

    const [total, byStatus, bySeverity, byCategory] = await Promise.all([
      this.prisma.analyticsInsight.count({ where }),
      this.prisma.analyticsInsight.groupBy({
        by: ['status'],
        where,
        _count: true,
      }),
      this.prisma.analyticsInsight.groupBy({
        by: ['severity'],
        where,
        _count: true,
      }),
      this.prisma.analyticsInsight.groupBy({
        by: ['category'],
        where,
        _count: true,
      }),
    ]);

    return {
      total,
      byStatus: Object.fromEntries(byStatus.map(s => [s.status, s._count])),
      bySeverity: Object.fromEntries(bySeverity.map(s => [s.severity, s._count])),
      byCategory: Object.fromEntries(byCategory.map(s => [s.category, s._count])),
    };
  }

  /**
   * Get actionable insights (NEW or IN_PROGRESS)
   */
  async getActionableInsights(tenantId: string): Promise<InsightResponseDto[]> {
    const insights = await this.prisma.analyticsInsight.findMany({
      where: {
        tenantId,
        status: { in: [InsightStatus.NEW, InsightStatus.IN_PROGRESS] },
        validFrom: { lte: new Date() },
        OR: [
          { validUntil: null },
          { validUntil: { gte: new Date() } },
        ],
      },
      orderBy: [
        { severity: 'desc' },
        { confidenceScore: 'desc' },
      ],
      take: 10,
    });

    return insights.map(this.mapToResponseDto);
  }

  /**
   * Get insights affecting specific tables
   */
  async getInsightsForTables(
    tenantId: string,
    tableIds: string[]
  ): Promise<InsightResponseDto[]> {
    // Note: Prisma doesn't support array contains directly, so we fetch and filter
    const insights = await this.prisma.analyticsInsight.findMany({
      where: {
        tenantId,
        status: { not: InsightStatus.DISMISSED },
        validFrom: { lte: new Date() },
        OR: [
          { validUntil: null },
          { validUntil: { gte: new Date() } },
        ],
      },
    });

    const filtered = insights.filter(insight => {
      if (insight.affectedTableIds.length === 0) return false;
      return insight.affectedTableIds.some(id => tableIds.includes(id));
    });

    return filtered.map(this.mapToResponseDto);
  }

  /**
   * Generate new insights based on analytics data
   * This is called periodically or on-demand to refresh insights
   */
  async generateInsights(tenantId: string): Promise<number> {
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const insights: Array<{
      type: string;
      category: string;
      severity: string;
      title: string;
      description: string;
      recommendation: string;
      affectedTableIds: string[];
      affectedAreaData: Prisma.InputJsonValue | null;
      supportingData: Prisma.InputJsonValue | null;
      potentialImpact: string | null;
      confidenceScore: number;
      status: string;
      validFrom: Date;
      validUntil: Date;
      tenantId: string;
    }> = [];

    // Check for underutilized tables
    const tableAnalytics = await this.prisma.tableAnalytics.groupBy({
      by: ['tableId'],
      where: {
        tenantId,
        date: {
          gte: oneWeekAgo,
          lte: now,
        },
      },
      _avg: {
        utilizationScore: true,
        revenuePerMinute: true,
      },
    });

    const tables = await this.prisma.table.findMany({
      where: { tenantId },
      select: { id: true, number: true, voxelX: true, voxelZ: true },
    });
    const tableMap = new Map(tables.map(t => [t.id, t]));

    const avgUtilization = tableAnalytics.length > 0
      ? tableAnalytics.reduce((sum, t) => sum + (t._avg.utilizationScore || 0), 0) / tableAnalytics.length
      : 50;

    for (const analytics of tableAnalytics) {
      const utilization = analytics._avg.utilizationScore || 0;
      const table = tableMap.get(analytics.tableId);

      // Underutilization insight
      if (utilization < avgUtilization * 0.6) {
        const existingInsight = await this.prisma.analyticsInsight.findFirst({
          where: {
            tenantId,
            type: InsightType.TABLE_UNDERUTILIZATION,
            affectedTableIds: { has: analytics.tableId },
            status: { not: InsightStatus.DISMISSED },
            validUntil: { gte: now },
          },
        });

        if (!existingInsight) {
          insights.push({
            type: InsightType.TABLE_UNDERUTILIZATION,
            category: InsightCategory.REVENUE,
            severity: utilization < avgUtilization * 0.3 ? InsightSeverity.WARNING : InsightSeverity.INFO,
            title: `Table ${table?.number || analytics.tableId} is underutilized`,
            description: `Table ${table?.number} has ${Math.round(utilization)}% utilization over the past week, significantly below the restaurant average of ${Math.round(avgUtilization)}%.`,
            recommendation: `Consider repositioning Table ${table?.number} to a more visible location or evaluating its placement for customer comfort.`,
            affectedTableIds: [analytics.tableId],
            affectedAreaData: table?.voxelX != null && table?.voxelZ != null ? {
              x: table.voxelX,
              z: table.voxelZ,
              radius: 2,
            } : null,
            supportingData: {
              currentUtilization: Math.round(utilization),
              avgUtilization: Math.round(avgUtilization),
              revenuePerMinute: analytics._avg.revenuePerMinute,
            },
            potentialImpact: `Could increase table utilization by ${Math.round(avgUtilization - utilization)}%`,
            confidenceScore: 0.8,
            status: InsightStatus.NEW,
            validFrom: now,
            validUntil: oneWeekFromNow,
            tenantId,
          });
        }
      }
    }

    // Check for traffic bottlenecks
    const trafficData = await this.prisma.trafficFlowRecord.findMany({
      where: {
        tenantId,
        hourBucket: {
          gte: oneWeekAgo,
          lte: now,
        },
        avgDwellTime: { gte: 60 }, // High dwell time indicates congestion
      },
      select: {
        cellX: true,
        cellZ: true,
        personCount: true,
        avgDwellTime: true,
      },
    });

    // Aggregate congestion points
    const congestionMap = new Map<string, { count: number; totalDwell: number; totalPersons: number }>();
    for (const record of trafficData) {
      const key = `${record.cellX},${record.cellZ}`;
      const existing = congestionMap.get(key) || { count: 0, totalDwell: 0, totalPersons: 0 };
      existing.count++;
      existing.totalDwell += record.avgDwellTime || 0;
      existing.totalPersons += record.personCount;
      congestionMap.set(key, existing);
    }

    for (const [key, data] of congestionMap) {
      const avgDwell = data.totalDwell / data.count;
      const avgPersons = data.totalPersons / data.count;

      if (avgDwell > 90 && avgPersons > 10) { // Significant congestion
        const [x, z] = key.split(',').map(Number);

        const existingInsight = await this.prisma.analyticsInsight.findFirst({
          where: {
            tenantId,
            type: InsightType.TRAFFIC_BOTTLENECK,
            status: { not: InsightStatus.DISMISSED },
            validUntil: { gte: now },
          },
        });

        if (!existingInsight) {
          insights.push({
            type: InsightType.TRAFFIC_BOTTLENECK,
            category: InsightCategory.OPERATIONAL,
            severity: avgDwell > 120 ? InsightSeverity.WARNING : InsightSeverity.INFO,
            title: 'Traffic congestion detected',
            description: `High traffic congestion detected at grid position (${x}, ${z}) with average dwell time of ${Math.round(avgDwell)} seconds.`,
            recommendation: 'Consider widening pathways or adding signage to improve traffic flow in this area.',
            affectedTableIds: [],
            affectedAreaData: {
              x: x * 2 - 10, // Convert grid to world coordinates
              z: z * 2 - 10,
              width: 2,
              depth: 2,
            },
            supportingData: {
              avgDwellTime: Math.round(avgDwell),
              avgPersonCount: Math.round(avgPersons),
              totalOccurrences: data.count,
            },
            potentialImpact: `Could reduce customer wait time by ${Math.round(avgDwell - 30)} seconds`,
            confidenceScore: 0.75,
            status: InsightStatus.NEW,
            validFrom: now,
            validUntil: oneWeekFromNow,
            tenantId,
          });
          break; // Only one traffic insight at a time
        }
      }
    }

    // Insert new insights
    if (insights.length > 0) {
      await this.prisma.analyticsInsight.createMany({
        data: insights,
        skipDuplicates: true,
      });
    }

    this.logger.log(`Generated ${insights.length} new insights for tenant ${tenantId}`);
    return insights.length;
  }

  /**
   * Archive old/expired insights
   */
  async archiveExpiredInsights(tenantId: string): Promise<number> {
    const result = await this.prisma.analyticsInsight.deleteMany({
      where: {
        tenantId,
        validUntil: { lt: new Date() },
        status: { in: [InsightStatus.IMPLEMENTED, InsightStatus.DISMISSED] },
      },
    });

    this.logger.log(`Archived ${result.count} expired insights for tenant ${tenantId}`);
    return result.count;
  }

  // Private helper methods

  private mapToResponseDto(insight: {
    id: string;
    type: string;
    category: string;
    severity: string;
    title: string;
    description: string;
    recommendation: string;
    affectedTableIds: string[];
    affectedAreaData: unknown;
    supportingData: unknown;
    potentialImpact: string | null;
    confidenceScore: number;
    status: string;
    reviewedAt: Date | null;
    implementedAt: Date | null;
    dismissedReason: string | null;
    validFrom: Date;
    validUntil: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): InsightResponseDto {
    return {
      id: insight.id,
      type: insight.type as InsightType,
      category: insight.category as InsightCategory,
      severity: insight.severity as InsightSeverity,
      title: insight.title,
      description: insight.description,
      recommendation: insight.recommendation,
      affectedTableIds: insight.affectedTableIds,
      affectedAreaData: insight.affectedAreaData as Record<string, unknown> | undefined,
      supportingData: insight.supportingData as Record<string, unknown> | undefined,
      potentialImpact: insight.potentialImpact || undefined,
      confidenceScore: insight.confidenceScore,
      status: insight.status as InsightStatus,
      reviewedAt: insight.reviewedAt || undefined,
      implementedAt: insight.implementedAt || undefined,
      dismissedReason: insight.dismissedReason || undefined,
      validFrom: insight.validFrom,
      validUntil: insight.validUntil || undefined,
      createdAt: insight.createdAt,
      updatedAt: insight.updatedAt,
    };
  }
}
