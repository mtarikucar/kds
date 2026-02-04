import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { PlanFeatureGuard } from '../subscriptions/guards/plan-feature.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequiresFeature } from '../subscriptions/decorators/requires-feature.decorator';
import { UserRole } from '../../common/constants/roles.enum';
import { PlanFeature } from '../../common/constants/subscription.enum';

import {
  MockDataGeneratorService,
  HeatmapService,
  TableAnalyticsService,
  InsightsService,
  CameraService,
} from './services';
import {
  CreateCameraDto,
  UpdateCameraDto,
  InsightFilterDto,
  UpdateInsightStatusDto,
} from './dto';
import { HeatmapGranularity } from './enums/analytics.enum';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
export class AnalyticsController {
  constructor(
    private readonly mockDataService: MockDataGeneratorService,
    private readonly heatmapService: HeatmapService,
    private readonly tableAnalyticsService: TableAnalyticsService,
    private readonly insightsService: InsightsService,
    private readonly cameraService: CameraService,
  ) {}

  // ==================== HEATMAP ENDPOINTS ====================

  @Get('heatmap/occupancy')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get occupancy heatmap data' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date (ISO format)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date (ISO format)' })
  @ApiQuery({ name: 'granularity', required: false, enum: HeatmapGranularity })
  @ApiResponse({ status: 200, description: 'Occupancy heatmap data' })
  async getOccupancyHeatmap(
    @Request() req,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('granularity') granularity?: HeatmapGranularity,
  ) {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    return this.heatmapService.getOccupancyHeatmap(req.tenantId, start, end, { granularity });
  }

  @Get('heatmap/traffic')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get traffic flow heatmap data' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date (ISO format)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date (ISO format)' })
  @ApiQuery({ name: 'granularity', required: false, enum: HeatmapGranularity })
  @ApiResponse({ status: 200, description: 'Traffic heatmap data' })
  async getTrafficHeatmap(
    @Request() req,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('granularity') granularity?: HeatmapGranularity,
  ) {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    return this.heatmapService.getTrafficHeatmap(req.tenantId, start, end, { granularity });
  }

  @Get('heatmap/dwell-time')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get dwell time heatmap data' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date (ISO format)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date (ISO format)' })
  @ApiQuery({ name: 'granularity', required: false, enum: HeatmapGranularity })
  @ApiResponse({ status: 200, description: 'Dwell time heatmap data' })
  async getDwellTimeHeatmap(
    @Request() req,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('granularity') granularity?: HeatmapGranularity,
  ) {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    return this.heatmapService.getDwellTimeHeatmap(req.tenantId, start, end, { granularity });
  }

  @Get('traffic/flow')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get traffic flow paths for visualization' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date (ISO format)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date (ISO format)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max number of paths (default: 50)' })
  @ApiResponse({ status: 200, description: 'Traffic flow paths' })
  async getTrafficFlow(
    @Request() req,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
  ) {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    const limitNum = limit ? parseInt(limit, 10) : 50;
    return this.heatmapService.getTrafficFlowPaths(req.tenantId, start, end, limitNum);
  }

  @Get('traffic/congestion')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get congestion analysis' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date (ISO format)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date (ISO format)' })
  @ApiResponse({ status: 200, description: 'Congestion analysis' })
  async getCongestionAnalysis(
    @Request() req,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    return this.heatmapService.getCongestionAnalysis(req.tenantId, start, end);
  }

  // ==================== TABLE ANALYTICS ENDPOINTS ====================

  @Get('tables/utilization')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get table utilization analytics' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date (ISO format)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date (ISO format)' })
  @ApiResponse({ status: 200, description: 'Table utilization data' })
  async getTableUtilization(
    @Request() req,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    return this.tableAnalyticsService.getTableUtilization(req.tenantId, start, end);
  }

  @Get('tables/trends')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get table utilization trends' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date (ISO format)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date (ISO format)' })
  @ApiResponse({ status: 200, description: 'Utilization trends' })
  async getUtilizationTrends(
    @Request() req,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return this.tableAnalyticsService.getUtilizationTrends(req.tenantId, start, end);
  }

  @Get('tables/underutilized')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get underutilized tables' })
  @ApiQuery({ name: 'threshold', required: false, description: 'Utilization threshold (default: 50)' })
  @ApiResponse({ status: 200, description: 'Underutilized tables' })
  async getUnderutilizedTables(
    @Request() req,
    @Query('threshold') threshold?: string,
  ) {
    const thresholdNum = threshold ? parseInt(threshold, 10) : 50;
    return this.tableAnalyticsService.getUnderutilizedTables(req.tenantId, thresholdNum);
  }

  @Get('customer-behavior')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get customer behavior analytics' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date (ISO format)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date (ISO format)' })
  @ApiResponse({ status: 200, description: 'Customer behavior data' })
  async getCustomerBehavior(
    @Request() req,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    return this.tableAnalyticsService.getCustomerBehavior(req.tenantId, start, end);
  }

  // ==================== INSIGHTS ENDPOINTS ====================

  @Get('insights')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get AI-generated insights' })
  @ApiResponse({ status: 200, description: 'List of insights' })
  async getInsights(@Request() req, @Query() filters: InsightFilterDto) {
    return this.insightsService.getInsights(req.tenantId, filters);
  }

  @Get('insights/summary')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get insights summary' })
  @ApiResponse({ status: 200, description: 'Insights summary counts' })
  async getInsightsSummary(@Request() req) {
    return this.insightsService.getInsightSummary(req.tenantId);
  }

  @Get('insights/actionable')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get actionable insights' })
  @ApiResponse({ status: 200, description: 'Actionable insights' })
  async getActionableInsights(@Request() req) {
    return this.insightsService.getActionableInsights(req.tenantId);
  }

  @Get('insights/:id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get insight by ID' })
  @ApiParam({ name: 'id', description: 'Insight ID' })
  @ApiResponse({ status: 200, description: 'Insight details' })
  async getInsightById(@Request() req, @Param('id') id: string) {
    return this.insightsService.getInsightById(req.tenantId, id);
  }

  @Put('insights/:id/status')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Update insight status' })
  @ApiParam({ name: 'id', description: 'Insight ID' })
  @ApiResponse({ status: 200, description: 'Updated insight' })
  async updateInsightStatus(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: UpdateInsightStatusDto,
  ) {
    return this.insightsService.updateInsightStatus(req.tenantId, id, req.user.id, dto);
  }

  @Post('insights/generate')
  @Roles(UserRole.ADMIN)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Manually trigger insight generation' })
  @ApiResponse({ status: 200, description: 'Number of insights generated' })
  async generateInsights(@Request() req) {
    const count = await this.insightsService.generateInsights(req.tenantId);
    return { generated: count };
  }

  // ==================== CAMERA ENDPOINTS ====================

  @Get('cameras')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get all cameras' })
  @ApiResponse({ status: 200, description: 'List of cameras' })
  async getCameras(@Request() req) {
    return this.cameraService.getCameras(req.tenantId);
  }

  @Get('cameras/health')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get camera health summary' })
  @ApiResponse({ status: 200, description: 'Camera health summary' })
  async getCameraHealth(@Request() req) {
    return this.cameraService.getCameraHealthSummary(req.tenantId);
  }

  @Get('cameras/:id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get camera by ID' })
  @ApiParam({ name: 'id', description: 'Camera ID' })
  @ApiResponse({ status: 200, description: 'Camera details' })
  async getCameraById(@Request() req, @Param('id') id: string) {
    return this.cameraService.getCameraById(req.tenantId, id);
  }

  @Post('cameras')
  @Roles(UserRole.ADMIN)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Create a new camera' })
  @ApiResponse({ status: 201, description: 'Camera created' })
  async createCamera(@Request() req, @Body() dto: CreateCameraDto) {
    return this.cameraService.createCamera(req.tenantId, dto);
  }

  @Put('cameras/:id')
  @Roles(UserRole.ADMIN)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Update camera' })
  @ApiParam({ name: 'id', description: 'Camera ID' })
  @ApiResponse({ status: 200, description: 'Camera updated' })
  async updateCamera(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: UpdateCameraDto,
  ) {
    return this.cameraService.updateCamera(req.tenantId, id, dto);
  }

  @Delete('cameras/:id')
  @Roles(UserRole.ADMIN)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Delete camera' })
  @ApiParam({ name: 'id', description: 'Camera ID' })
  @ApiResponse({ status: 200, description: 'Camera deleted' })
  async deleteCamera(@Request() req, @Param('id') id: string) {
    await this.cameraService.deleteCamera(req.tenantId, id);
    return { success: true };
  }

  @Put('cameras/:id/calibration')
  @Roles(UserRole.ADMIN)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Update camera calibration' })
  @ApiParam({ name: 'id', description: 'Camera ID' })
  @ApiResponse({ status: 200, description: 'Calibration updated' })
  async updateCameraCalibration(
    @Request() req,
    @Param('id') id: string,
    @Body() calibrationData: Record<string, unknown>,
  ) {
    return this.cameraService.updateCalibration(req.tenantId, id, calibrationData);
  }

  // ==================== MOCK DATA ENDPOINTS (DEV ONLY) ====================

  @Post('mock-data/generate')
  @Roles(UserRole.ADMIN)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Generate mock analytics data (development only)' })
  @ApiQuery({ name: 'days', required: false, description: 'Number of days to generate (default: 7)' })
  @ApiResponse({ status: 200, description: 'Mock data generation results' })
  async generateMockData(
    @Request() req,
    @Query('days') days?: string,
  ) {
    const daysNum = days ? parseInt(days, 10) : 7;
    return this.mockDataService.generateAllMockData(req.tenantId, daysNum);
  }

  @Delete('mock-data')
  @Roles(UserRole.ADMIN)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Clear all analytics data (development only)' })
  @ApiResponse({ status: 200, description: 'Data cleared' })
  async clearMockData(@Request() req) {
    await this.mockDataService.clearAnalyticsData(req.tenantId);
    return { success: true };
  }
}
