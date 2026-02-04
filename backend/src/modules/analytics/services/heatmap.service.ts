import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { HeatmapMetric, HeatmapGranularity } from '../enums/analytics.enum';
import {
  HeatmapResponseDto,
  HeatmapCellDto,
  TrafficFlowResponseDto,
  TrafficFlowPathDto,
  CongestionResponseDto,
  CongestionPointDto,
} from '../dto';

interface HeatmapOptions {
  metric?: HeatmapMetric;
  granularity?: HeatmapGranularity;
  gridWidth?: number;
  gridDepth?: number;
  cellSize?: number;
}

@Injectable()
export class HeatmapService {
  private readonly logger = new Logger(HeatmapService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get occupancy heatmap data
   */
  async getOccupancyHeatmap(
    tenantId: string,
    startDate: Date,
    endDate: Date,
    options: HeatmapOptions = {}
  ): Promise<HeatmapResponseDto> {
    const {
      granularity = HeatmapGranularity.HOURLY,
      gridWidth = 20,
      gridDepth = 20,
      cellSize = 1.0,
    } = options;

    // Check cache first
    const cached = await this.getCachedHeatmap(
      tenantId,
      startDate,
      endDate,
      HeatmapMetric.OCCUPANCY,
      granularity
    );
    if (cached) {
      return cached;
    }

    // Fetch occupancy records
    const records = await this.prisma.occupancyRecord.findMany({
      where: {
        tenantId,
        timestamp: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        positionX: true,
        positionZ: true,
        state: true,
      },
    });

    // Initialize grid
    const grid = this.initializeGrid(gridWidth, gridDepth);
    const offsetX = gridWidth / 2;
    const offsetZ = gridDepth / 2;

    // Aggregate data into grid cells
    for (const record of records) {
      const cellX = Math.floor((record.positionX + offsetX * cellSize) / cellSize);
      const cellZ = Math.floor((record.positionZ + offsetZ * cellSize) / cellSize);

      if (cellX >= 0 && cellX < gridWidth && cellZ >= 0 && cellZ < gridDepth) {
        grid[cellZ][cellX]++;
      }
    }

    // Normalize data
    const { normalizedGrid, maxValue, minValue } = this.normalizeGrid(grid);

    // Find hotspots
    const hotspots = this.findHotspots(normalizedGrid, cellSize, offsetX, offsetZ);

    const response: HeatmapResponseDto = {
      metric: HeatmapMetric.OCCUPANCY,
      granularity,
      startTime: startDate,
      endTime: endDate,
      gridWidth,
      gridDepth,
      cellSize,
      data: normalizedGrid,
      maxValue,
      minValue,
      hotspots,
    };

    // Cache the result
    await this.cacheHeatmap(tenantId, response, granularity);

    return response;
  }

  /**
   * Get traffic flow heatmap data
   */
  async getTrafficHeatmap(
    tenantId: string,
    startDate: Date,
    endDate: Date,
    options: HeatmapOptions = {}
  ): Promise<HeatmapResponseDto> {
    const {
      granularity = HeatmapGranularity.HOURLY,
      gridWidth = 20,
      gridDepth = 20,
      cellSize = 1.0,
    } = options;

    // Check cache first
    const cached = await this.getCachedHeatmap(
      tenantId,
      startDate,
      endDate,
      HeatmapMetric.TRAFFIC,
      granularity
    );
    if (cached) {
      return cached;
    }

    // Fetch traffic flow records
    const records = await this.prisma.trafficFlowRecord.findMany({
      where: {
        tenantId,
        hourBucket: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        cellX: true,
        cellZ: true,
        personCount: true,
      },
    });

    // Initialize grid
    const grid = this.initializeGrid(gridWidth, gridDepth);

    // Aggregate data
    for (const record of records) {
      if (record.cellX >= 0 && record.cellX < gridWidth && record.cellZ >= 0 && record.cellZ < gridDepth) {
        grid[record.cellZ][record.cellX] += record.personCount;
      }
    }

    // Normalize data
    const { normalizedGrid, maxValue, minValue } = this.normalizeGrid(grid);

    // Find hotspots
    const hotspots = this.findHotspots(normalizedGrid, cellSize, gridWidth / 2, gridDepth / 2);

    const response: HeatmapResponseDto = {
      metric: HeatmapMetric.TRAFFIC,
      granularity,
      startTime: startDate,
      endTime: endDate,
      gridWidth,
      gridDepth,
      cellSize,
      data: normalizedGrid,
      maxValue,
      minValue,
      hotspots,
    };

    // Cache the result
    await this.cacheHeatmap(tenantId, response, granularity);

    return response;
  }

  /**
   * Get dwell time heatmap
   */
  async getDwellTimeHeatmap(
    tenantId: string,
    startDate: Date,
    endDate: Date,
    options: HeatmapOptions = {}
  ): Promise<HeatmapResponseDto> {
    const {
      granularity = HeatmapGranularity.HOURLY,
      gridWidth = 20,
      gridDepth = 20,
      cellSize = 1.0,
    } = options;

    // Fetch traffic flow records with dwell time
    const records = await this.prisma.trafficFlowRecord.findMany({
      where: {
        tenantId,
        hourBucket: {
          gte: startDate,
          lte: endDate,
        },
        avgDwellTime: { not: null },
      },
      select: {
        cellX: true,
        cellZ: true,
        avgDwellTime: true,
        personCount: true,
      },
    });

    // Initialize grids for weighted average calculation
    const dwellGrid = this.initializeGrid(gridWidth, gridDepth);
    const countGrid = this.initializeGrid(gridWidth, gridDepth);

    // Aggregate data (weighted by person count)
    for (const record of records) {
      if (record.cellX >= 0 && record.cellX < gridWidth && record.cellZ >= 0 && record.cellZ < gridDepth) {
        dwellGrid[record.cellZ][record.cellX] += (record.avgDwellTime || 0) * record.personCount;
        countGrid[record.cellZ][record.cellX] += record.personCount;
      }
    }

    // Calculate weighted average
    const grid = dwellGrid.map((row, z) =>
      row.map((val, x) =>
        countGrid[z][x] > 0 ? val / countGrid[z][x] : 0
      )
    );

    // Normalize data
    const { normalizedGrid, maxValue, minValue } = this.normalizeGrid(grid);

    // Find hotspots
    const hotspots = this.findHotspots(normalizedGrid, cellSize, gridWidth / 2, gridDepth / 2);

    return {
      metric: HeatmapMetric.DWELL_TIME,
      granularity,
      startTime: startDate,
      endTime: endDate,
      gridWidth,
      gridDepth,
      cellSize,
      data: normalizedGrid,
      maxValue,
      minValue,
      hotspots,
    };
  }

  /**
   * Get traffic flow paths for visualization
   */
  async getTrafficFlowPaths(
    tenantId: string,
    startDate: Date,
    endDate: Date,
    limit: number = 50
  ): Promise<TrafficFlowResponseDto> {
    // Get unique tracking IDs within time range
    const trackingIds = await this.prisma.occupancyRecord.findMany({
      where: {
        tenantId,
        timestamp: {
          gte: startDate,
          lte: endDate,
        },
        state: 'MOVING',
      },
      select: {
        trackingId: true,
      },
      distinct: ['trackingId'],
      take: limit,
    });

    const paths: TrafficFlowPathDto[] = [];

    // Get path points for each tracking ID
    for (const { trackingId } of trackingIds) {
      const points = await this.prisma.occupancyRecord.findMany({
        where: {
          tenantId,
          trackingId,
          timestamp: {
            gte: startDate,
            lte: endDate,
          },
        },
        select: {
          positionX: true,
          positionZ: true,
          timestamp: true,
        },
        orderBy: {
          timestamp: 'asc',
        },
      });

      if (points.length >= 2) {
        const firstPoint = points[0];
        const lastPoint = points[points.length - 1];
        const duration = (lastPoint.timestamp.getTime() - firstPoint.timestamp.getTime()) / 1000;

        paths.push({
          trackingId,
          points: points.map(p => ({
            x: p.positionX,
            z: p.positionZ,
            timestamp: p.timestamp,
          })),
          duration,
        });
      }
    }

    // Calculate summary statistics
    const totalVisitors = trackingIds.length;
    const avgDwellTime = paths.length > 0
      ? paths.reduce((sum, p) => sum + p.duration, 0) / paths.length
      : 0;

    return {
      startTime: startDate,
      endTime: endDate,
      paths,
      totalVisitors,
      avgDwellTime,
    };
  }

  /**
   * Get congestion analysis
   */
  async getCongestionAnalysis(
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<CongestionResponseDto> {
    // Get traffic flow data with high dwell times
    const records = await this.prisma.trafficFlowRecord.findMany({
      where: {
        tenantId,
        hourBucket: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        cellX: true,
        cellZ: true,
        personCount: true,
        avgDwellTime: true,
        hourBucket: true,
      },
    });

    // Aggregate by cell
    const cellData = new Map<string, {
      x: number;
      z: number;
      totalPersons: number;
      totalDwell: number;
      count: number;
      peakHour: number;
      peakCount: number;
    }>();

    for (const record of records) {
      const key = `${record.cellX},${record.cellZ}`;
      const hour = record.hourBucket.getHours();

      if (!cellData.has(key)) {
        cellData.set(key, {
          x: record.cellX,
          z: record.cellZ,
          totalPersons: 0,
          totalDwell: 0,
          count: 0,
          peakHour: hour,
          peakCount: record.personCount,
        });
      }

      const data = cellData.get(key)!;
      data.totalPersons += record.personCount;
      data.totalDwell += (record.avgDwellTime || 0) * record.personCount;
      data.count++;

      if (record.personCount > data.peakCount) {
        data.peakHour = hour;
        data.peakCount = record.personCount;
      }
    }

    // Calculate congestion points
    const congestionPoints: CongestionPointDto[] = [];
    let totalSeverity = 0;

    for (const [, data] of cellData) {
      const avgPersons = data.totalPersons / data.count;
      const avgDwell = data.count > 0 ? data.totalDwell / data.totalPersons : 0;

      // Congestion threshold: high traffic + high dwell time
      const trafficScore = Math.min(avgPersons / 50, 1); // Normalize to 0-1
      const dwellScore = Math.min(avgDwell / 120, 1); // 2 minutes = max

      const severity = (trafficScore * 0.6 + dwellScore * 0.4);

      if (severity > 0.5) {
        congestionPoints.push({
          x: data.x,
          z: data.z,
          severity,
          avgWaitTime: avgDwell,
          peakHour: data.peakHour,
        });
        totalSeverity += severity;
      }
    }

    // Sort by severity
    congestionPoints.sort((a, b) => b.severity - a.severity);

    // Calculate overall score (inverse - lower is better)
    const overallScore = congestionPoints.length > 0
      ? Math.round((1 - totalSeverity / congestionPoints.length) * 100)
      : 100;

    // Generate recommendations
    const recommendations: string[] = [];
    if (congestionPoints.length > 0) {
      recommendations.push('Consider widening high-traffic pathways');
      recommendations.push('Implement a queue management system during peak hours');
    }
    if (congestionPoints.some(p => p.peakHour >= 12 && p.peakHour <= 14)) {
      recommendations.push('Add staff during lunch rush (12:00-14:00)');
    }
    if (congestionPoints.some(p => p.peakHour >= 18 && p.peakHour <= 21)) {
      recommendations.push('Consider reservation-only dining during dinner peak');
    }

    return {
      congestionPoints: congestionPoints.slice(0, 10), // Top 10
      overallScore,
      recommendations,
    };
  }

  // Private helper methods

  private initializeGrid(width: number, depth: number): number[][] {
    return Array(depth).fill(null).map(() => Array(width).fill(0));
  }

  private normalizeGrid(grid: number[][]): {
    normalizedGrid: number[][];
    maxValue: number;
    minValue: number;
  } {
    let maxValue = 0;
    let minValue = Infinity;

    for (const row of grid) {
      for (const val of row) {
        if (val > maxValue) maxValue = val;
        if (val < minValue && val > 0) minValue = val;
      }
    }

    if (minValue === Infinity) minValue = 0;

    const range = maxValue - minValue || 1;
    const normalizedGrid = grid.map(row =>
      row.map(val => val > 0 ? (val - minValue) / range : 0)
    );

    return { normalizedGrid, maxValue, minValue };
  }

  private findHotspots(
    grid: number[][],
    cellSize: number,
    offsetX: number,
    offsetZ: number,
    threshold: number = 0.7
  ): HeatmapCellDto[] {
    const hotspots: HeatmapCellDto[] = [];

    for (let z = 0; z < grid.length; z++) {
      for (let x = 0; x < grid[z].length; x++) {
        if (grid[z][x] >= threshold) {
          hotspots.push({
            x: (x - offsetX) * cellSize,
            z: (z - offsetZ) * cellSize,
            value: grid[z][x],
          });
        }
      }
    }

    return hotspots.sort((a, b) => b.value - a.value).slice(0, 10);
  }

  private async getCachedHeatmap(
    tenantId: string,
    startTime: Date,
    endTime: Date,
    metric: HeatmapMetric,
    granularity: HeatmapGranularity
  ): Promise<HeatmapResponseDto | null> {
    const cached = await this.prisma.analyticsHeatmapCache.findUnique({
      where: {
        tenantId_startTime_endTime_granularity_metric: {
          tenantId,
          startTime,
          endTime,
          granularity,
          metric,
        },
      },
    });

    if (cached && cached.expiresAt > new Date()) {
      return {
        metric: cached.metric as HeatmapMetric,
        granularity: cached.granularity as HeatmapGranularity,
        startTime: cached.startTime,
        endTime: cached.endTime,
        gridWidth: cached.gridWidth,
        gridDepth: cached.gridDepth,
        cellSize: cached.cellSize,
        data: cached.heatmapData as number[][],
        maxValue: cached.maxValue,
        minValue: cached.minValue,
      };
    }

    return null;
  }

  private async cacheHeatmap(
    tenantId: string,
    heatmap: HeatmapResponseDto,
    granularity: HeatmapGranularity
  ): Promise<void> {
    const ttlHours = granularity === HeatmapGranularity.HOURLY ? 1 :
                     granularity === HeatmapGranularity.DAILY ? 6 : 24;

    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    await this.prisma.analyticsHeatmapCache.upsert({
      where: {
        tenantId_startTime_endTime_granularity_metric: {
          tenantId,
          startTime: heatmap.startTime,
          endTime: heatmap.endTime,
          granularity: heatmap.granularity,
          metric: heatmap.metric,
        },
      },
      update: {
        heatmapData: heatmap.data,
        maxValue: heatmap.maxValue,
        minValue: heatmap.minValue,
        expiresAt,
      },
      create: {
        tenantId,
        startTime: heatmap.startTime,
        endTime: heatmap.endTime,
        granularity: heatmap.granularity,
        metric: heatmap.metric,
        gridWidth: heatmap.gridWidth,
        gridDepth: heatmap.gridDepth,
        cellSize: heatmap.cellSize,
        heatmapData: heatmap.data,
        maxValue: heatmap.maxValue,
        minValue: heatmap.minValue,
        expiresAt,
      },
    });
  }
}
