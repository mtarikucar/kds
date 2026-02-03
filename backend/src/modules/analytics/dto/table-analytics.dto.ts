import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TableUtilizationDto {
  @ApiProperty({ description: 'Table ID' })
  tableId: string;

  @ApiProperty({ description: 'Table number' })
  tableNumber: string;

  @ApiPropertyOptional({ description: 'Table section' })
  section?: string;

  @ApiProperty({ description: 'Table capacity' })
  capacity: number;

  @ApiProperty({ description: 'Total minutes table was occupied' })
  occupiedMinutes: number;

  @ApiProperty({ description: 'Total minutes with active dining' })
  diningMinutes: number;

  @ApiProperty({ description: 'Total minutes occupied but idle (no orders)' })
  idleMinutes: number;

  @ApiProperty({ description: 'Total minutes table was empty' })
  emptyMinutes: number;

  @ApiProperty({ description: 'Number of table turns (sessions)' })
  sessions: number;

  @ApiProperty({ description: 'Total revenue generated' })
  revenue: number;

  @ApiProperty({ description: 'Number of orders' })
  orders: number;

  @ApiProperty({ description: 'Utilization score (0-100)' })
  utilizationScore: number;

  @ApiProperty({ description: 'Revenue per minute when occupied' })
  revenuePerMinute: number;

  @ApiPropertyOptional({ description: 'Average session duration in minutes' })
  avgSessionDuration?: number;

  @ApiPropertyOptional({ description: 'Average order value' })
  avgOrderValue?: number;

  @ApiPropertyOptional({
    description: 'Peak hours occupancy (hour -> percentage)',
    type: Object,
    example: { '12': 80, '13': 95, '19': 100 }
  })
  peakHours?: Record<number, number>;
}

export class TableUtilizationSummaryDto {
  @ApiProperty({ description: 'Total number of tables' })
  totalTables: number;

  @ApiProperty({ description: 'Average utilization across all tables (0-100)' })
  avgUtilization: number;

  @ApiProperty({ description: 'Total revenue from all tables' })
  totalRevenue: number;

  @ApiProperty({ description: 'Total table turns (sessions)' })
  totalSessions: number;

  @ApiProperty({ description: 'Most utilized table' })
  topTable: TableUtilizationDto;

  @ApiProperty({ description: 'Least utilized table' })
  bottomTable: TableUtilizationDto;

  @ApiProperty({ description: 'Tables with low utilization (< 50%)', type: [TableUtilizationDto] })
  underutilizedTables: TableUtilizationDto[];

  @ApiProperty({ description: 'Peak occupancy hour (0-23)' })
  peakHour: number;

  @ApiProperty({ description: 'Peak occupancy percentage' })
  peakOccupancy: number;
}

export class TableAnalyticsResponseDto {
  @ApiProperty({ description: 'Date for this analytics data' })
  date: Date;

  @ApiProperty({ description: 'Summary statistics' })
  summary: TableUtilizationSummaryDto;

  @ApiProperty({ description: 'Per-table utilization data', type: [TableUtilizationDto] })
  tables: TableUtilizationDto[];
}

export class TableComparisonDto {
  @ApiProperty({ description: 'Table ID' })
  tableId: string;

  @ApiProperty({ description: 'Table number' })
  tableNumber: string;

  @ApiProperty({ description: 'Current period utilization (0-100)' })
  currentUtilization: number;

  @ApiProperty({ description: 'Previous period utilization (0-100)' })
  previousUtilization: number;

  @ApiProperty({ description: 'Change in utilization percentage' })
  change: number;

  @ApiProperty({ description: 'Current period revenue' })
  currentRevenue: number;

  @ApiProperty({ description: 'Previous period revenue' })
  previousRevenue: number;

  @ApiProperty({ description: 'Revenue change percentage' })
  revenueChange: number;
}

export class TableTrendDto {
  @ApiProperty({ description: 'Date' })
  date: Date;

  @ApiProperty({ description: 'Average utilization across all tables' })
  avgUtilization: number;

  @ApiProperty({ description: 'Total revenue' })
  totalRevenue: number;

  @ApiProperty({ description: 'Total sessions' })
  totalSessions: number;
}

export class TableAnalyticsTrendResponseDto {
  @ApiProperty({ description: 'Start date' })
  startDate: Date;

  @ApiProperty({ description: 'End date' })
  endDate: Date;

  @ApiProperty({ description: 'Daily trend data', type: [TableTrendDto] })
  trends: TableTrendDto[];

  @ApiPropertyOptional({ description: 'Per-table comparison', type: [TableComparisonDto] })
  tableComparisons?: TableComparisonDto[];
}

export class CustomerBehaviorDto {
  @ApiProperty({ description: 'Average time spent dining (minutes)' })
  avgDiningTime: number;

  @ApiProperty({ description: 'Average idle time after dining (minutes)' })
  avgIdleTime: number;

  @ApiProperty({ description: 'Ratio of idle to dining time' })
  idleToDiningRatio: number;

  @ApiProperty({ description: 'Average party size' })
  avgPartySize: number;

  @ApiProperty({ description: 'Peak arrival hour (0-23)' })
  peakArrivalHour: number;

  @ApiProperty({ description: 'Peak departure hour (0-23)' })
  peakDepartureHour: number;

  @ApiProperty({ description: 'Average order value' })
  avgOrderValue: number;

  @ApiPropertyOptional({ description: 'Hourly distribution of arrivals', type: Object })
  arrivalDistribution?: Record<number, number>;
}
