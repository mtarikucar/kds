// Enums
export enum PersonState {
  STANDING = 'STANDING',
  SITTING = 'SITTING',
  MOVING = 'MOVING',
  WAITING = 'WAITING',
}

export enum CameraStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  ERROR = 'ERROR',
  CALIBRATING = 'CALIBRATING',
}

export enum InsightType {
  SPACE_OPTIMIZATION = 'SPACE_OPTIMIZATION',
  TRAFFIC_BOTTLENECK = 'TRAFFIC_BOTTLENECK',
  TABLE_UNDERUTILIZATION = 'TABLE_UNDERUTILIZATION',
  CUSTOMER_BEHAVIOR = 'CUSTOMER_BEHAVIOR',
  REVENUE_OPPORTUNITY = 'REVENUE_OPPORTUNITY',
  STAFFING_SUGGESTION = 'STAFFING_SUGGESTION',
}

export enum InsightCategory {
  OPERATIONAL = 'OPERATIONAL',
  REVENUE = 'REVENUE',
  CUSTOMER = 'CUSTOMER',
  LAYOUT = 'LAYOUT',
}

export enum InsightSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
}

export enum InsightStatus {
  NEW = 'NEW',
  REVIEWED = 'REVIEWED',
  IN_PROGRESS = 'IN_PROGRESS',
  IMPLEMENTED = 'IMPLEMENTED',
  DISMISSED = 'DISMISSED',
}

export enum HeatmapMetric {
  OCCUPANCY = 'OCCUPANCY',
  DWELL_TIME = 'DWELL_TIME',
  TRAFFIC = 'TRAFFIC',
  REVENUE = 'REVENUE',
}

export enum HeatmapGranularity {
  HOURLY = 'HOURLY',
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
}

// DTOs
export interface DateRangeParams {
  startDate?: string;
  endDate?: string;
}

export interface HeatmapQueryParams extends DateRangeParams {
  granularity?: HeatmapGranularity;
}

// Response Types
export interface HeatmapCell {
  x: number;
  z: number;
  value: number;
  rawValue?: number;
}

export interface HeatmapResponse {
  metric: HeatmapMetric;
  granularity: HeatmapGranularity;
  startTime: string;
  endTime: string;
  gridWidth: number;
  gridDepth: number;
  cellSize: number;
  data: number[][];
  maxValue: number;
  minValue: number;
  hotspots?: HeatmapCell[];
}

export interface TrafficFlowPoint {
  x: number;
  z: number;
  timestamp: string;
}

export interface TrafficFlowPath {
  trackingId: string;
  points: TrafficFlowPoint[];
  duration: number;
}

export interface TrafficFlowResponse {
  startTime: string;
  endTime: string;
  paths: TrafficFlowPath[];
  totalVisitors: number;
  avgDwellTime: number;
  entryPoints?: Record<string, number>;
  exitPoints?: Record<string, number>;
}

export interface CongestionPoint {
  x: number;
  z: number;
  severity: number;
  avgWaitTime: number;
  peakHour: number;
}

export interface CongestionResponse {
  congestionPoints: CongestionPoint[];
  overallScore: number;
  recommendations?: string[];
}

export interface TableUtilization {
  tableId: string;
  tableNumber: string;
  section?: string;
  capacity: number;
  occupiedMinutes: number;
  diningMinutes: number;
  idleMinutes: number;
  emptyMinutes: number;
  sessions: number;
  revenue: number;
  orders: number;
  utilizationScore: number;
  revenuePerMinute: number;
  avgSessionDuration?: number;
  avgOrderValue?: number;
  peakHours?: Record<number, number>;
}

export interface TableUtilizationSummary {
  totalTables: number;
  avgUtilization: number;
  totalRevenue: number;
  totalSessions: number;
  topTable: TableUtilization;
  bottomTable: TableUtilization;
  underutilizedTables: TableUtilization[];
  peakHour: number;
  peakOccupancy: number;
}

export interface TableAnalyticsResponse {
  date: string;
  summary: TableUtilizationSummary;
  tables: TableUtilization[];
}

export interface TableTrend {
  date: string;
  avgUtilization: number;
  totalRevenue: number;
  totalSessions: number;
}

export interface TableComparison {
  tableId: string;
  tableNumber: string;
  currentUtilization: number;
  previousUtilization: number;
  change: number;
  currentRevenue: number;
  previousRevenue: number;
  revenueChange: number;
}

export interface TableTrendResponse {
  startDate: string;
  endDate: string;
  trends: TableTrend[];
  tableComparisons?: TableComparison[];
}

export interface CustomerBehavior {
  avgDiningTime: number;
  avgIdleTime: number;
  idleToDiningRatio: number;
  avgPartySize: number;
  peakArrivalHour: number;
  peakDepartureHour: number;
  avgOrderValue: number;
  arrivalDistribution?: Record<number, number>;
}

export interface Insight {
  id: string;
  type: InsightType;
  category: InsightCategory;
  severity: InsightSeverity;
  title: string;
  description: string;
  recommendation: string;
  affectedTableIds?: string[];
  affectedAreaData?: Record<string, unknown>;
  supportingData?: Record<string, unknown>;
  potentialImpact?: string;
  confidenceScore: number;
  status: InsightStatus;
  reviewedAt?: string;
  implementedAt?: string;
  dismissedReason?: string;
  validFrom: string;
  validUntil?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InsightListResponse {
  insights: Insight[];
  total: number;
  limit: number;
  offset: number;
}

export interface InsightSummary {
  total: number;
  byStatus: Record<string, number>;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
}

export interface Camera {
  id: string;
  name: string;
  description?: string;
  streamUrl: string;
  streamType: string;
  status: CameraStatus;
  voxelX?: number;
  voxelY?: number;
  voxelZ?: number;
  rotationY?: number;
  fov?: number;
  calibrationData?: Record<string, unknown>;
  lastSeenAt?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CameraHealthSummary {
  total: number;
  online: number;
  offline: number;
  error: number;
  calibrating: number;
}

export interface MockDataGenerationResult {
  occupancyRecords: number;
  trafficFlowRecords: number;
  tableAnalyticsRecords: number;
  insights: number;
}
