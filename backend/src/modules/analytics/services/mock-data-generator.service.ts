import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PersonState, InsightType, InsightCategory, InsightSeverity } from '../enums/analytics.enum';

interface TableInfo {
  id: string;
  number: string;
  voxelX: number | null;
  voxelZ: number | null;
  capacity: number;
}

interface OccupancyPoint {
  trackingId: string;
  positionX: number;
  positionZ: number;
  state: PersonState;
  tableId: string | null;
  confidence: number;
}

@Injectable()
export class MockDataGeneratorService {
  private readonly logger = new Logger(MockDataGeneratorService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Generate mock occupancy data for a time range
   */
  async generateOccupancyData(
    tenantId: string,
    startDate: Date,
    endDate: Date,
    intervalMinutes: number = 5
  ): Promise<number> {
    const tables = await this.getTables(tenantId);
    if (tables.length === 0) {
      this.logger.warn(`No tables found for tenant ${tenantId}`);
      return 0;
    }

    const records: Array<{
      timestamp: Date;
      trackingId: string;
      positionX: number;
      positionZ: number;
      positionY: number;
      state: string;
      confidence: number;
      tableId: string | null;
      cameraId: string | null;
      tenantId: string;
    }> = [];

    let currentTime = new Date(startDate);
    let trackingIdCounter = 0;

    while (currentTime <= endDate) {
      const hour = currentTime.getHours();
      const dayOfWeek = currentTime.getDay();

      // Simulate restaurant activity patterns
      const activityLevel = this.getActivityLevel(hour, dayOfWeek);
      const occupiedTables = this.selectRandomTables(tables, activityLevel);

      // Generate occupancy points for this timestamp
      for (const table of occupiedTables) {
        const partySize = Math.min(
          Math.floor(Math.random() * table.capacity) + 1,
          table.capacity
        );

        for (let i = 0; i < partySize; i++) {
          const point = this.generateOccupancyPoint(
            table,
            `track_${tenantId.slice(0, 8)}_${++trackingIdCounter}`
          );

          records.push({
            timestamp: new Date(currentTime),
            trackingId: point.trackingId,
            positionX: point.positionX,
            positionZ: point.positionZ,
            positionY: 0,
            state: point.state,
            confidence: point.confidence,
            tableId: point.tableId,
            cameraId: null,
            tenantId,
          });
        }
      }

      // Add some walking customers (not at tables)
      const walkingCount = Math.floor(activityLevel * 3 * Math.random());
      for (let i = 0; i < walkingCount; i++) {
        records.push({
          timestamp: new Date(currentTime),
          trackingId: `track_${tenantId.slice(0, 8)}_${++trackingIdCounter}`,
          positionX: Math.random() * 20 - 10,
          positionZ: Math.random() * 20 - 10,
          positionY: 0,
          state: Math.random() > 0.3 ? PersonState.MOVING : PersonState.WAITING,
          confidence: 0.85 + Math.random() * 0.15,
          tableId: null,
          cameraId: null,
          tenantId,
        });
      }

      currentTime = new Date(currentTime.getTime() + intervalMinutes * 60 * 1000);
    }

    // Batch insert
    if (records.length > 0) {
      await this.prisma.occupancyRecord.createMany({
        data: records,
        skipDuplicates: true,
      });
    }

    this.logger.log(`Generated ${records.length} occupancy records for tenant ${tenantId}`);
    return records.length;
  }

  /**
   * Generate mock traffic flow data
   */
  async generateTrafficFlowData(
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    const records: Array<{
      hourBucket: Date;
      cellX: number;
      cellZ: number;
      cellSize: number;
      personCount: number;
      avgDwellTime: number | null;
      entrances: number;
      exits: number;
      flowDirections: Record<string, number> | null;
      tenantId: string;
    }> = [];

    const gridSize = 10; // 10x10 grid
    const cellSize = 2.0; // 2 meters per cell

    let currentHour = new Date(startDate);
    currentHour.setMinutes(0, 0, 0);

    while (currentHour <= endDate) {
      const hour = currentHour.getHours();
      const dayOfWeek = currentHour.getDay();
      const activityLevel = this.getActivityLevel(hour, dayOfWeek);

      for (let x = 0; x < gridSize; x++) {
        for (let z = 0; z < gridSize; z++) {
          // Higher traffic near center and entrance areas
          const distanceFromCenter = Math.sqrt(
            Math.pow(x - gridSize / 2, 2) + Math.pow(z - gridSize / 2, 2)
          );
          const locationMultiplier = 1 - distanceFromCenter / (gridSize / 2) * 0.5;

          // Add entrance bonus (assume entrance at z=0)
          const entranceBonus = z < 2 ? 1.5 : 1;

          const baseCount = Math.floor(
            activityLevel * 20 * locationMultiplier * entranceBonus * (0.5 + Math.random() * 0.5)
          );

          if (baseCount > 0) {
            records.push({
              hourBucket: new Date(currentHour),
              cellX: x,
              cellZ: z,
              cellSize,
              personCount: baseCount,
              avgDwellTime: 10 + Math.random() * 50,
              entrances: Math.floor(baseCount * 0.4),
              exits: Math.floor(baseCount * 0.4),
              flowDirections: {
                north: Math.floor(baseCount * 0.25),
                south: Math.floor(baseCount * 0.25),
                east: Math.floor(baseCount * 0.25),
                west: Math.floor(baseCount * 0.25),
              },
              tenantId,
            });
          }
        }
      }

      currentHour = new Date(currentHour.getTime() + 60 * 60 * 1000); // Next hour
    }

    if (records.length > 0) {
      // Use upsert for traffic flow records (unique constraint on tenant+hour+cell)
      for (const record of records) {
        await this.prisma.trafficFlowRecord.upsert({
          where: {
            tenantId_hourBucket_cellX_cellZ: {
              tenantId: record.tenantId,
              hourBucket: record.hourBucket,
              cellX: record.cellX,
              cellZ: record.cellZ,
            },
          },
          update: {
            personCount: { increment: record.personCount },
          },
          create: record,
        });
      }
    }

    this.logger.log(`Generated ${records.length} traffic flow records for tenant ${tenantId}`);
    return records.length;
  }

  /**
   * Generate mock table analytics data
   */
  async generateTableAnalyticsData(
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    const tables = await this.getTables(tenantId);
    if (tables.length === 0) {
      return 0;
    }

    const records: Array<{
      date: Date;
      tableId: string;
      totalOccupiedMinutes: number;
      totalDiningMinutes: number;
      totalIdleMinutes: number;
      totalEmptyMinutes: number;
      totalSessions: number;
      avgSessionDuration: number | null;
      avgDiningDuration: number | null;
      avgIdleDuration: number | null;
      revenueGenerated: number;
      ordersCount: number;
      avgOrderValue: number | null;
      revenuePerMinute: number | null;
      utilizationScore: number | null;
      peakHours: Record<number, number> | null;
      tenantId: string;
    }> = [];

    let currentDate = new Date(startDate);
    currentDate.setHours(0, 0, 0, 0);

    const endDateNormalized = new Date(endDate);
    endDateNormalized.setHours(23, 59, 59, 999);

    while (currentDate <= endDateNormalized) {
      const dayOfWeek = currentDate.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      for (const table of tables) {
        // Simulate different utilization based on table location and capacity
        const baseUtilization = 0.3 + Math.random() * 0.5;
        const weekendMultiplier = isWeekend ? 1.3 : 1;
        const capacityMultiplier = table.capacity <= 2 ? 1.2 : table.capacity >= 6 ? 0.8 : 1;

        const operatingMinutes = 12 * 60; // 12 hours operation
        const occupiedMinutes = Math.floor(
          operatingMinutes * baseUtilization * weekendMultiplier * capacityMultiplier
        );

        const diningRatio = 0.6 + Math.random() * 0.3;
        const diningMinutes = Math.floor(occupiedMinutes * diningRatio);
        const idleMinutes = occupiedMinutes - diningMinutes;
        const emptyMinutes = operatingMinutes - occupiedMinutes;

        const sessions = Math.max(1, Math.floor(occupiedMinutes / (45 + Math.random() * 30)));
        const avgSessionDuration = sessions > 0 ? occupiedMinutes / sessions : null;
        const avgDiningDuration = sessions > 0 ? diningMinutes / sessions : null;
        const avgIdleDuration = sessions > 0 ? idleMinutes / sessions : null;

        const avgOrderValueBase = 50 + Math.random() * 100;
        const ordersCount = sessions;
        const revenueGenerated = avgOrderValueBase * ordersCount;
        const avgOrderValue = ordersCount > 0 ? revenueGenerated / ordersCount : null;
        const revenuePerMinute = occupiedMinutes > 0 ? revenueGenerated / occupiedMinutes : null;
        const utilizationScore = (occupiedMinutes / operatingMinutes) * 100;

        // Generate peak hours
        const peakHours: Record<number, number> = {};
        for (let h = 10; h <= 22; h++) {
          if (h >= 12 && h <= 14) {
            peakHours[h] = 70 + Math.random() * 30; // Lunch peak
          } else if (h >= 18 && h <= 21) {
            peakHours[h] = 80 + Math.random() * 20; // Dinner peak
          } else {
            peakHours[h] = 20 + Math.random() * 40;
          }
        }

        records.push({
          date: new Date(currentDate),
          tableId: table.id,
          totalOccupiedMinutes: occupiedMinutes,
          totalDiningMinutes: diningMinutes,
          totalIdleMinutes: idleMinutes,
          totalEmptyMinutes: emptyMinutes,
          totalSessions: sessions,
          avgSessionDuration,
          avgDiningDuration,
          avgIdleDuration,
          revenueGenerated,
          ordersCount,
          avgOrderValue,
          revenuePerMinute,
          utilizationScore,
          peakHours,
          tenantId,
        });
      }

      currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000); // Next day
    }

    if (records.length > 0) {
      for (const record of records) {
        await this.prisma.tableAnalytics.upsert({
          where: {
            tableId_date: {
              tableId: record.tableId,
              date: record.date,
            },
          },
          update: record,
          create: record,
        });
      }
    }

    this.logger.log(`Generated ${records.length} table analytics records for tenant ${tenantId}`);
    return records.length;
  }

  /**
   * Generate mock AI insights
   */
  async generateInsights(tenantId: string): Promise<number> {
    const tables = await this.getTables(tenantId);

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
      validUntil: Date | null;
      tenantId: string;
    }> = [];

    const now = new Date();
    const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Underutilized table insight
    if (tables.length > 0) {
      const randomTable = tables[Math.floor(Math.random() * tables.length)];
      insights.push({
        type: InsightType.TABLE_UNDERUTILIZATION,
        category: InsightCategory.REVENUE,
        severity: InsightSeverity.WARNING,
        title: `Table ${randomTable.number} is underutilized`,
        description: `Table ${randomTable.number} has only 35% utilization over the past week, significantly below the restaurant average of 65%.`,
        recommendation: `Consider repositioning Table ${randomTable.number} to a more visible location or promoting it for larger groups.`,
        affectedTableIds: [randomTable.id],
        affectedAreaData: randomTable.voxelX !== null && randomTable.voxelZ !== null ? {
          x: randomTable.voxelX,
          z: randomTable.voxelZ,
          radius: 2,
        } : null,
        supportingData: {
          currentUtilization: 35,
          avgUtilization: 65,
          weeklyRevenue: 450,
          potentialRevenue: 850,
        },
        potentialImpact: 'Could increase table revenue by 45%',
        confidenceScore: 0.85,
        status: 'NEW',
        validFrom: now,
        validUntil: oneWeekFromNow,
        tenantId,
      });
    }

    // Traffic bottleneck insight
    insights.push({
      type: InsightType.TRAFFIC_BOTTLENECK,
      category: InsightCategory.OPERATIONAL,
      severity: InsightSeverity.INFO,
      title: 'Congestion detected near entrance during peak hours',
      description: 'Customer flow analysis shows significant congestion near the main entrance between 12:00-13:00 and 19:00-20:00.',
      recommendation: 'Consider adding a waiting area or implementing a reservation system to better manage peak hour traffic.',
      affectedTableIds: [],
      affectedAreaData: {
        x: 0,
        z: -8,
        width: 4,
        depth: 3,
      },
      supportingData: {
        avgWaitTime: 180, // seconds
        peakCongestion: 0.85,
        affectedHours: [12, 13, 19, 20],
      },
      potentialImpact: 'Could reduce customer wait time by 40%',
      confidenceScore: 0.78,
      status: 'NEW',
      validFrom: now,
      validUntil: oneWeekFromNow,
      tenantId,
    });

    // Customer behavior insight
    insights.push({
      type: InsightType.CUSTOMER_BEHAVIOR,
      category: InsightCategory.CUSTOMER,
      severity: InsightSeverity.INFO,
      title: 'Customers are staying longer after dining',
      description: 'Average post-dining time has increased to 45 minutes, reducing table turnover during peak hours.',
      recommendation: 'Consider offering take-away desserts or implementing subtle cues (like presenting the bill) to encourage turnover.',
      affectedTableIds: [],
      affectedAreaData: null,
      supportingData: {
        avgDiningTime: 55, // minutes
        avgIdleTime: 45, // minutes
        targetIdleTime: 15, // minutes
        revenueImpact: -15, // percent
      },
      potentialImpact: 'Could increase revenue by 15% during peak hours',
      confidenceScore: 0.72,
      status: 'NEW',
      validFrom: now,
      validUntil: oneWeekFromNow,
      tenantId,
    });

    // Space optimization insight
    insights.push({
      type: InsightType.SPACE_OPTIMIZATION,
      category: InsightCategory.LAYOUT,
      severity: InsightSeverity.WARNING,
      title: 'Dead zone detected in corner area',
      description: 'The northeast corner of the restaurant receives minimal customer traffic and contributes only 5% of total revenue.',
      recommendation: 'Consider adding a promotional display, bar seating, or converting to a cozy lounge area to increase utilization.',
      affectedTableIds: tables.slice(0, 2).map(t => t.id),
      affectedAreaData: {
        x: 8,
        z: 8,
        width: 4,
        depth: 4,
      },
      supportingData: {
        areaTrafficPercent: 8,
        areaRevenuePercent: 5,
        potentialIncrease: 200, // percent
      },
      potentialImpact: 'Could generate additional $500/day in revenue',
      confidenceScore: 0.81,
      status: 'NEW',
      validFrom: now,
      validUntil: oneWeekFromNow,
      tenantId,
    });

    if (insights.length > 0) {
      await this.prisma.analyticsInsight.createMany({
        data: insights,
        skipDuplicates: true,
      });
    }

    this.logger.log(`Generated ${insights.length} insights for tenant ${tenantId}`);
    return insights.length;
  }

  /**
   * Generate all mock data for a tenant
   */
  async generateAllMockData(
    tenantId: string,
    daysBack: number = 7
  ): Promise<{
    occupancyRecords: number;
    trafficFlowRecords: number;
    tableAnalyticsRecords: number;
    insights: number;
  }> {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - daysBack * 24 * 60 * 60 * 1000);

    const occupancyRecords = await this.generateOccupancyData(tenantId, startDate, endDate);
    const trafficFlowRecords = await this.generateTrafficFlowData(tenantId, startDate, endDate);
    const tableAnalyticsRecords = await this.generateTableAnalyticsData(tenantId, startDate, endDate);
    const insights = await this.generateInsights(tenantId);

    return {
      occupancyRecords,
      trafficFlowRecords,
      tableAnalyticsRecords,
      insights,
    };
  }

  /**
   * Clear all analytics data for a tenant
   */
  async clearAnalyticsData(tenantId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.occupancyRecord.deleteMany({ where: { tenantId } }),
      this.prisma.trafficFlowRecord.deleteMany({ where: { tenantId } }),
      this.prisma.tableAnalytics.deleteMany({ where: { tenantId } }),
      this.prisma.analyticsInsight.deleteMany({ where: { tenantId } }),
      this.prisma.analyticsHeatmapCache.deleteMany({ where: { tenantId } }),
    ]);
    this.logger.log(`Cleared all analytics data for tenant ${tenantId}`);
  }

  // Private helper methods

  private async getTables(tenantId: string): Promise<TableInfo[]> {
    return this.prisma.table.findMany({
      where: { tenantId },
      select: {
        id: true,
        number: true,
        voxelX: true,
        voxelZ: true,
        capacity: true,
      },
    });
  }

  private getActivityLevel(hour: number, dayOfWeek: number): number {
    // 0 = Sunday, 6 = Saturday
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const weekendMultiplier = isWeekend ? 1.3 : 1;

    // Restaurant activity pattern
    if (hour < 10 || hour >= 23) return 0;
    if (hour >= 10 && hour < 12) return 0.3 * weekendMultiplier; // Morning
    if (hour >= 12 && hour < 14) return 0.8 * weekendMultiplier; // Lunch peak
    if (hour >= 14 && hour < 17) return 0.4 * weekendMultiplier; // Afternoon
    if (hour >= 17 && hour < 19) return 0.6 * weekendMultiplier; // Early evening
    if (hour >= 19 && hour < 21) return 1.0 * weekendMultiplier; // Dinner peak
    if (hour >= 21 && hour < 23) return 0.5 * weekendMultiplier; // Late evening

    return 0.3;
  }

  private selectRandomTables(tables: TableInfo[], activityLevel: number): TableInfo[] {
    const targetCount = Math.floor(tables.length * activityLevel);
    const shuffled = [...tables].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, targetCount);
  }

  private generateOccupancyPoint(table: TableInfo, trackingId: string): OccupancyPoint {
    // Position near table with some randomness
    const offsetX = (Math.random() - 0.5) * 1.5;
    const offsetZ = (Math.random() - 0.5) * 1.5;

    return {
      trackingId,
      positionX: (table.voxelX ?? 0) + offsetX,
      positionZ: (table.voxelZ ?? 0) + offsetZ,
      state: Math.random() > 0.1 ? PersonState.SITTING : PersonState.STANDING,
      tableId: table.id,
      confidence: 0.85 + Math.random() * 0.15,
    };
  }
}
