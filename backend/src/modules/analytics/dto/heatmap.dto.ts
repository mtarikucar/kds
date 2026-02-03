import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HeatmapMetric, HeatmapGranularity } from '../enums/analytics.enum';

export class HeatmapCellDto {
  @ApiProperty({ description: 'X coordinate in grid' })
  x: number;

  @ApiProperty({ description: 'Z coordinate in grid' })
  z: number;

  @ApiProperty({ description: 'Cell value (normalized 0-1)' })
  value: number;

  @ApiPropertyOptional({ description: 'Raw count/value before normalization' })
  rawValue?: number;
}

export class HeatmapResponseDto {
  @ApiProperty({ enum: HeatmapMetric, description: 'Type of metric displayed' })
  metric: HeatmapMetric;

  @ApiProperty({ enum: HeatmapGranularity, description: 'Time granularity' })
  granularity: HeatmapGranularity;

  @ApiProperty({ description: 'Start of the time range' })
  startTime: Date;

  @ApiProperty({ description: 'End of the time range' })
  endTime: Date;

  @ApiProperty({ description: 'Grid width in cells' })
  gridWidth: number;

  @ApiProperty({ description: 'Grid depth in cells' })
  gridDepth: number;

  @ApiProperty({ description: 'Cell size in meters' })
  cellSize: number;

  @ApiProperty({
    description: 'Heatmap data as 2D array [z][x]',
    type: [[Number]],
    example: [[0.1, 0.5, 0.3], [0.2, 0.8, 0.4]]
  })
  data: number[][];

  @ApiProperty({ description: 'Maximum value in data (for legend scaling)' })
  maxValue: number;

  @ApiProperty({ description: 'Minimum value in data' })
  minValue: number;

  @ApiPropertyOptional({ description: 'High-value cells for quick reference', type: [HeatmapCellDto] })
  hotspots?: HeatmapCellDto[];
}

export class TrafficFlowPointDto {
  @ApiProperty({ description: 'X position in meters' })
  x: number;

  @ApiProperty({ description: 'Z position in meters' })
  z: number;

  @ApiProperty({ description: 'Timestamp of the point' })
  timestamp: Date;
}

export class TrafficFlowPathDto {
  @ApiProperty({ description: 'Tracking ID for this path' })
  trackingId: string;

  @ApiProperty({ description: 'Sequence of points in the path', type: [TrafficFlowPointDto] })
  points: TrafficFlowPointDto[];

  @ApiProperty({ description: 'Total duration of the path in seconds' })
  duration: number;
}

export class TrafficFlowResponseDto {
  @ApiProperty({ description: 'Start of the time range' })
  startTime: Date;

  @ApiProperty({ description: 'End of the time range' })
  endTime: Date;

  @ApiProperty({ description: 'Flow paths for visualization', type: [TrafficFlowPathDto] })
  paths: TrafficFlowPathDto[];

  @ApiProperty({ description: 'Total number of unique visitors' })
  totalVisitors: number;

  @ApiProperty({ description: 'Average dwell time in seconds' })
  avgDwellTime: number;

  @ApiPropertyOptional({ description: 'Entry point distribution', type: Object })
  entryPoints?: Record<string, number>;

  @ApiPropertyOptional({ description: 'Exit point distribution', type: Object })
  exitPoints?: Record<string, number>;
}

export class CongestionPointDto {
  @ApiProperty({ description: 'X position in meters' })
  x: number;

  @ApiProperty({ description: 'Z position in meters' })
  z: number;

  @ApiProperty({ description: 'Congestion severity (0-1)' })
  severity: number;

  @ApiProperty({ description: 'Average wait time in seconds' })
  avgWaitTime: number;

  @ApiProperty({ description: 'Peak hour for this congestion point' })
  peakHour: number;
}

export class CongestionResponseDto {
  @ApiProperty({ description: 'Congestion hotspots', type: [CongestionPointDto] })
  congestionPoints: CongestionPointDto[];

  @ApiProperty({ description: 'Overall congestion score (0-100)' })
  overallScore: number;

  @ApiPropertyOptional({ description: 'Recommendations to reduce congestion', type: [String] })
  recommendations?: string[];
}
