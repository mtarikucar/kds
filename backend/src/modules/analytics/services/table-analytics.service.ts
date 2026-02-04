import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  TableAnalyticsResponseDto,
  TableUtilizationDto,
  TableUtilizationSummaryDto,
  TableAnalyticsTrendResponseDto,
  TableTrendDto,
  TableComparisonDto,
  CustomerBehaviorDto,
} from '../dto';

@Injectable()
export class TableAnalyticsService {
  private readonly logger = new Logger(TableAnalyticsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get table utilization analytics for a specific date or date range
   */
  async getTableUtilization(
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<TableAnalyticsResponseDto> {
    // Get all tables
    const tables = await this.prisma.table.findMany({
      where: { tenantId },
      select: {
        id: true,
        number: true,
        section: true,
        capacity: true,
      },
    });

    // Get aggregated analytics for each table
    const analytics = await this.prisma.tableAnalytics.groupBy({
      by: ['tableId'],
      where: {
        tenantId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      _sum: {
        totalOccupiedMinutes: true,
        totalDiningMinutes: true,
        totalIdleMinutes: true,
        totalEmptyMinutes: true,
        totalSessions: true,
        ordersCount: true,
      },
      _avg: {
        avgSessionDuration: true,
        avgOrderValue: true,
        utilizationScore: true,
        revenuePerMinute: true,
      },
    });

    // Get revenue data separately (Decimal type needs special handling)
    const revenueData = await this.prisma.tableAnalytics.findMany({
      where: {
        tenantId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        tableId: true,
        revenueGenerated: true,
        peakHours: true,
      },
    });

    // Aggregate revenue by table
    const revenueByTable = new Map<string, { revenue: number; peakHours: Record<number, number> }>();
    for (const record of revenueData) {
      const existing = revenueByTable.get(record.tableId) || { revenue: 0, peakHours: {} };
      existing.revenue += Number(record.revenueGenerated);
      // Merge peak hours
      const recordPeakHours = record.peakHours as Record<number, number> | null;
      if (recordPeakHours) {
        for (const [hour, value] of Object.entries(recordPeakHours)) {
          existing.peakHours[Number(hour)] = (existing.peakHours[Number(hour)] || 0) + value;
        }
      }
      revenueByTable.set(record.tableId, existing);
    }

    // Create table utilization DTOs
    const tableMap = new Map(tables.map(t => [t.id, t]));
    const tableUtilizations: TableUtilizationDto[] = analytics.map(a => {
      const table = tableMap.get(a.tableId);
      const revenueInfo = revenueByTable.get(a.tableId);
      const occupiedMinutes = a._sum.totalOccupiedMinutes || 0;
      const revenue = revenueInfo?.revenue || 0;

      return {
        tableId: a.tableId,
        tableNumber: table?.number || 'Unknown',
        section: table?.section || undefined,
        capacity: table?.capacity || 0,
        occupiedMinutes,
        diningMinutes: a._sum.totalDiningMinutes || 0,
        idleMinutes: a._sum.totalIdleMinutes || 0,
        emptyMinutes: a._sum.totalEmptyMinutes || 0,
        sessions: a._sum.totalSessions || 0,
        revenue,
        orders: a._sum.ordersCount || 0,
        utilizationScore: a._avg.utilizationScore || 0,
        revenuePerMinute: occupiedMinutes > 0 ? revenue / occupiedMinutes : 0,
        avgSessionDuration: a._avg.avgSessionDuration || undefined,
        avgOrderValue: a._avg.avgOrderValue ? Number(a._avg.avgOrderValue) : undefined,
        peakHours: revenueInfo?.peakHours,
      };
    });

    // Add tables without analytics data
    for (const table of tables) {
      if (!tableUtilizations.find(t => t.tableId === table.id)) {
        tableUtilizations.push({
          tableId: table.id,
          tableNumber: table.number,
          section: table.section || undefined,
          capacity: table.capacity,
          occupiedMinutes: 0,
          diningMinutes: 0,
          idleMinutes: 0,
          emptyMinutes: 720, // 12 hours default
          sessions: 0,
          revenue: 0,
          orders: 0,
          utilizationScore: 0,
          revenuePerMinute: 0,
        });
      }
    }

    // Sort by utilization score
    tableUtilizations.sort((a, b) => b.utilizationScore - a.utilizationScore);

    // Calculate summary
    const summary = this.calculateSummary(tableUtilizations);

    return {
      date: startDate,
      summary,
      tables: tableUtilizations,
    };
  }

  /**
   * Get utilization trends over time
   */
  async getUtilizationTrends(
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<TableAnalyticsTrendResponseDto> {
    const dailyData = await this.prisma.tableAnalytics.groupBy({
      by: ['date'],
      where: {
        tenantId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      _avg: {
        utilizationScore: true,
      },
      _sum: {
        totalSessions: true,
      },
      orderBy: {
        date: 'asc',
      },
    });

    // Get revenue separately
    const revenueData = await this.prisma.tableAnalytics.findMany({
      where: {
        tenantId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        date: true,
        revenueGenerated: true,
      },
    });

    // Aggregate revenue by date
    const revenueByDate = new Map<string, number>();
    for (const record of revenueData) {
      const dateKey = record.date.toISOString().split('T')[0];
      revenueByDate.set(dateKey, (revenueByDate.get(dateKey) || 0) + Number(record.revenueGenerated));
    }

    const trends: TableTrendDto[] = dailyData.map(d => {
      const dateKey = d.date.toISOString().split('T')[0];
      return {
        date: d.date,
        avgUtilization: d._avg.utilizationScore || 0,
        totalRevenue: revenueByDate.get(dateKey) || 0,
        totalSessions: d._sum.totalSessions || 0,
      };
    });

    // Calculate table comparisons (current vs previous period)
    const periodLength = endDate.getTime() - startDate.getTime();
    const previousStart = new Date(startDate.getTime() - periodLength);
    const previousEnd = new Date(startDate.getTime() - 1);

    const tableComparisons = await this.calculateTableComparisons(
      tenantId,
      startDate,
      endDate,
      previousStart,
      previousEnd
    );

    return {
      startDate,
      endDate,
      trends,
      tableComparisons,
    };
  }

  /**
   * Get customer behavior analytics
   */
  async getCustomerBehavior(
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<CustomerBehaviorDto> {
    // Get aggregated session data
    const sessionData = await this.prisma.tableAnalytics.aggregate({
      where: {
        tenantId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      _avg: {
        avgSessionDuration: true,
        avgDiningDuration: true,
        avgIdleDuration: true,
        avgOrderValue: true,
      },
      _sum: {
        totalSessions: true,
      },
    });

    const avgDiningTime = sessionData._avg.avgDiningDuration || 0;
    const avgIdleTime = sessionData._avg.avgIdleDuration || 0;

    // Get peak hours from analytics
    const peakHoursData = await this.prisma.tableAnalytics.findMany({
      where: {
        tenantId,
        date: {
          gte: startDate,
          lte: endDate,
        },
        peakHours: { not: null },
      },
      select: {
        peakHours: true,
      },
    });

    // Aggregate peak hours
    const arrivalDistribution: Record<number, number> = {};
    for (const record of peakHoursData) {
      const peakHours = record.peakHours as Record<number, number> | null;
      if (peakHours) {
        for (const [hour, value] of Object.entries(peakHours)) {
          arrivalDistribution[Number(hour)] = (arrivalDistribution[Number(hour)] || 0) + value;
        }
      }
    }

    // Find peak arrival and departure hours
    let peakArrivalHour = 12;
    let peakDepartureHour = 21;
    let maxArrival = 0;

    for (const [hour, value] of Object.entries(arrivalDistribution)) {
      if (value > maxArrival) {
        maxArrival = value;
        peakArrivalHour = Number(hour);
      }
    }

    // Estimate departure based on session duration
    peakDepartureHour = Math.min(23, peakArrivalHour + Math.ceil((avgDiningTime + avgIdleTime) / 60));

    // Get average party size from occupancy data
    const occupancyData = await this.prisma.occupancyRecord.groupBy({
      by: ['tableId'],
      where: {
        tenantId,
        timestamp: {
          gte: startDate,
          lte: endDate,
        },
        tableId: { not: null },
        state: 'SITTING',
      },
      _count: true,
    });

    const tables = await this.prisma.table.findMany({
      where: { tenantId },
      select: { id: true, capacity: true },
    });

    const tableCapacityMap = new Map(tables.map(t => [t.id, t.capacity]));
    let totalPartySize = 0;
    let partyCount = 0;

    for (const record of occupancyData) {
      if (record.tableId) {
        const capacity = tableCapacityMap.get(record.tableId) || 4;
        // Estimate party size based on occupancy count relative to capacity
        const estimatedPartySize = Math.min(record._count, capacity);
        totalPartySize += estimatedPartySize;
        partyCount++;
      }
    }

    const avgPartySize = partyCount > 0 ? totalPartySize / partyCount : 2.5;

    return {
      avgDiningTime,
      avgIdleTime,
      idleToDiningRatio: avgDiningTime > 0 ? avgIdleTime / avgDiningTime : 0,
      avgPartySize: Math.round(avgPartySize * 10) / 10,
      peakArrivalHour,
      peakDepartureHour,
      avgOrderValue: Number(sessionData._avg.avgOrderValue || 0),
      arrivalDistribution,
    };
  }

  /**
   * Get underutilized tables
   */
  async getUnderutilizedTables(
    tenantId: string,
    threshold: number = 50
  ): Promise<TableUtilizationDto[]> {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000); // Last 7 days

    const analytics = await this.getTableUtilization(tenantId, startDate, endDate);
    return analytics.tables.filter(t => t.utilizationScore < threshold);
  }

  // Private helper methods

  private calculateSummary(tables: TableUtilizationDto[]): TableUtilizationSummaryDto {
    if (tables.length === 0) {
      return {
        totalTables: 0,
        avgUtilization: 0,
        totalRevenue: 0,
        totalSessions: 0,
        topTable: {} as TableUtilizationDto,
        bottomTable: {} as TableUtilizationDto,
        underutilizedTables: [],
        peakHour: 12,
        peakOccupancy: 0,
      };
    }

    const avgUtilization = tables.reduce((sum, t) => sum + t.utilizationScore, 0) / tables.length;
    const totalRevenue = tables.reduce((sum, t) => sum + t.revenue, 0);
    const totalSessions = tables.reduce((sum, t) => sum + t.sessions, 0);

    // Sort by utilization
    const sorted = [...tables].sort((a, b) => b.utilizationScore - a.utilizationScore);
    const topTable = sorted[0];
    const bottomTable = sorted[sorted.length - 1];
    const underutilizedTables = sorted.filter(t => t.utilizationScore < 50);

    // Calculate peak hour across all tables
    const hourlyTotals: Record<number, number> = {};
    for (const table of tables) {
      if (table.peakHours) {
        for (const [hour, value] of Object.entries(table.peakHours)) {
          hourlyTotals[Number(hour)] = (hourlyTotals[Number(hour)] || 0) + value;
        }
      }
    }

    let peakHour = 12;
    let peakOccupancy = 0;
    for (const [hour, value] of Object.entries(hourlyTotals)) {
      if (value > peakOccupancy) {
        peakOccupancy = value;
        peakHour = Number(hour);
      }
    }

    // Normalize peak occupancy to percentage
    const maxPossibleOccupancy = tables.length * 100; // 100% for each table
    peakOccupancy = maxPossibleOccupancy > 0 ? (peakOccupancy / maxPossibleOccupancy) * 100 : 0;

    return {
      totalTables: tables.length,
      avgUtilization: Math.round(avgUtilization * 10) / 10,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalSessions,
      topTable,
      bottomTable,
      underutilizedTables,
      peakHour,
      peakOccupancy: Math.round(peakOccupancy * 10) / 10,
    };
  }

  private async calculateTableComparisons(
    tenantId: string,
    currentStart: Date,
    currentEnd: Date,
    previousStart: Date,
    previousEnd: Date
  ): Promise<TableComparisonDto[]> {
    // Get current period data
    const currentData = await this.prisma.tableAnalytics.groupBy({
      by: ['tableId'],
      where: {
        tenantId,
        date: {
          gte: currentStart,
          lte: currentEnd,
        },
      },
      _avg: {
        utilizationScore: true,
      },
    });

    // Get current revenue
    const currentRevenue = await this.prisma.tableAnalytics.findMany({
      where: {
        tenantId,
        date: {
          gte: currentStart,
          lte: currentEnd,
        },
      },
      select: {
        tableId: true,
        revenueGenerated: true,
      },
    });

    const currentRevenueMap = new Map<string, number>();
    for (const r of currentRevenue) {
      currentRevenueMap.set(r.tableId, (currentRevenueMap.get(r.tableId) || 0) + Number(r.revenueGenerated));
    }

    // Get previous period data
    const previousData = await this.prisma.tableAnalytics.groupBy({
      by: ['tableId'],
      where: {
        tenantId,
        date: {
          gte: previousStart,
          lte: previousEnd,
        },
      },
      _avg: {
        utilizationScore: true,
      },
    });

    // Get previous revenue
    const previousRevenue = await this.prisma.tableAnalytics.findMany({
      where: {
        tenantId,
        date: {
          gte: previousStart,
          lte: previousEnd,
        },
      },
      select: {
        tableId: true,
        revenueGenerated: true,
      },
    });

    const previousRevenueMap = new Map<string, number>();
    for (const r of previousRevenue) {
      previousRevenueMap.set(r.tableId, (previousRevenueMap.get(r.tableId) || 0) + Number(r.revenueGenerated));
    }

    const previousMap = new Map(previousData.map(p => [p.tableId, p._avg.utilizationScore || 0]));

    // Get table info
    const tables = await this.prisma.table.findMany({
      where: { tenantId },
      select: { id: true, number: true },
    });
    const tableMap = new Map(tables.map(t => [t.id, t.number]));

    return currentData.map(c => {
      const currentUtil = c._avg.utilizationScore || 0;
      const previousUtil = previousMap.get(c.tableId) || 0;
      const currentRev = currentRevenueMap.get(c.tableId) || 0;
      const previousRev = previousRevenueMap.get(c.tableId) || 0;

      return {
        tableId: c.tableId,
        tableNumber: tableMap.get(c.tableId) || 'Unknown',
        currentUtilization: Math.round(currentUtil * 10) / 10,
        previousUtilization: Math.round(previousUtil * 10) / 10,
        change: Math.round((currentUtil - previousUtil) * 10) / 10,
        currentRevenue: Math.round(currentRev * 100) / 100,
        previousRevenue: Math.round(previousRev * 100) / 100,
        revenueChange: previousRev > 0
          ? Math.round(((currentRev - previousRev) / previousRev) * 1000) / 10
          : 0,
      };
    });
  }
}
