import {
  BadRequestException,
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
  ForbiddenException,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiQuery,
  ApiParam,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { PlanFeatureGuard } from "../subscriptions/guards/plan-feature.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { RequiresFeature } from "../subscriptions/decorators/requires-feature.decorator";
import { CurrentScope } from "../auth/decorators/current-scope.decorator";
import { BranchScope } from "../../common/scoping/branch-scope";
import { UserRole } from "../../common/constants/roles.enum";
import { PlanFeature } from "../../common/constants/subscription.enum";

import {
  MockDataGeneratorService,
  HeatmapService,
  TableAnalyticsService,
  InsightsService,
  CameraService,
} from "./services";
import {
  CreateCameraDto,
  UpdateCameraDto,
  DateRangeDto,
  HeatmapQueryDto,
  InsightFilterDto,
  UpdateInsightStatusDto,
} from "./dto";
import { HeatmapGranularity } from "./enums/analytics.enum";

// Iter-89: hard cap on the analytics date window. The heatmap, traffic,
// dwell-time, and table-utilization queries scan AnalyticsEvent /
// OccupancyMeasurement / Order rows inside [startDate, endDate]; without
// a cap a single admin posting `startDate=1970-01-01&endDate=2100-01-01`
// would scan years of telemetry per request. 366 days matches the iter-64
// reports cap (covers calendar-year + leap year reporting needs) and keeps
// per-call memory bounded.
const ANALYTICS_MAX_RANGE_DAYS = 366;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

@ApiTags("analytics")
@ApiBearerAuth()
@Controller("analytics")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
export class AnalyticsController {
  constructor(
    private readonly mockDataService: MockDataGeneratorService,
    private readonly heatmapService: HeatmapService,
    private readonly tableAnalyticsService: TableAnalyticsService,
    private readonly insightsService: InsightsService,
    private readonly cameraService: CameraService,
  ) {}

  /**
   * Iter-89: parse + validate a [startDate, endDate] window from a
   * DateRangeDto (already through ValidationPipe + @IsDateString) and
   * fall back to per-endpoint defaults when either side is omitted.
   * Pre-iter-89 every analytics endpoint did `new Date(startDate)`
   * directly — a malformed ISO produced `Invalid Date` (NaN) and every
   * gte/lte downstream silently returned false, surfacing as a confusing
   * empty heatmap instead of a 400 (same trap as iter-87 / iter-64).
   */
  private resolveRange(
    query: DateRangeDto | undefined,
    defaultStart: Date,
    defaultEnd: Date,
  ): { start: Date; end: Date } {
    const start = query?.startDate ? new Date(query.startDate) : defaultStart;
    const end = query?.endDate ? new Date(query.endDate) : defaultEnd;
    // @IsDateString catches most bad shapes upstream; this is defence in
    // depth (e.g. `2025-02-30T00:00:00Z` passes @IsDateString but constructs
    // Invalid Date).
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException("startDate must be a valid ISO-8601 date");
    }
    if (Number.isNaN(end.getTime())) {
      throw new BadRequestException("endDate must be a valid ISO-8601 date");
    }
    if (start > end) {
      throw new BadRequestException(
        "startDate must be before or equal to endDate",
      );
    }
    const windowDays = (end.getTime() - start.getTime()) / MILLIS_PER_DAY;
    if (windowDays > ANALYTICS_MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `Date range cannot exceed ${ANALYTICS_MAX_RANGE_DAYS} days. Split the request into smaller windows.`,
      );
    }
    return { start, end };
  }

  // ==================== HEATMAP ENDPOINTS ====================

  @Get("heatmap/occupancy")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Get occupancy heatmap data" })
  @ApiQuery({
    name: "startDate",
    required: false,
    description: "Start date (ISO format)",
  })
  @ApiQuery({
    name: "endDate",
    required: false,
    description: "End date (ISO format)",
  })
  @ApiQuery({ name: "granularity", required: false, enum: HeatmapGranularity })
  @ApiResponse({ status: 200, description: "Occupancy heatmap data" })
  async getOccupancyHeatmap(
    @Request() req,
    @CurrentScope() scope: BranchScope,
    @Query() query: HeatmapQueryDto,
  ) {
    const now = new Date();
    const { start, end } = this.resolveRange(
      query,
      new Date(now.getTime() - 24 * 60 * 60 * 1000),
      now,
    );
    return this.heatmapService.getOccupancyHeatmap(
      req.tenantId,
      scope.branchId,
      start,
      end,
      { granularity: query.granularity },
    );
  }

  @Get("heatmap/traffic")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Get traffic flow heatmap data" })
  @ApiQuery({
    name: "startDate",
    required: false,
    description: "Start date (ISO format)",
  })
  @ApiQuery({
    name: "endDate",
    required: false,
    description: "End date (ISO format)",
  })
  @ApiQuery({ name: "granularity", required: false, enum: HeatmapGranularity })
  @ApiResponse({ status: 200, description: "Traffic heatmap data" })
  async getTrafficHeatmap(
    @Request() req,
    @CurrentScope() scope: BranchScope,
    @Query() query: HeatmapQueryDto,
  ) {
    const now = new Date();
    const { start, end } = this.resolveRange(
      query,
      new Date(now.getTime() - 24 * 60 * 60 * 1000),
      now,
    );
    return this.heatmapService.getTrafficHeatmap(
      req.tenantId,
      scope.branchId,
      start,
      end,
      { granularity: query.granularity },
    );
  }

  @Get("heatmap/dwell-time")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Get dwell time heatmap data" })
  @ApiQuery({
    name: "startDate",
    required: false,
    description: "Start date (ISO format)",
  })
  @ApiQuery({
    name: "endDate",
    required: false,
    description: "End date (ISO format)",
  })
  @ApiQuery({ name: "granularity", required: false, enum: HeatmapGranularity })
  @ApiResponse({ status: 200, description: "Dwell time heatmap data" })
  async getDwellTimeHeatmap(
    @Request() req,
    @CurrentScope() scope: BranchScope,
    @Query() query: HeatmapQueryDto,
  ) {
    const now = new Date();
    const { start, end } = this.resolveRange(
      query,
      new Date(now.getTime() - 24 * 60 * 60 * 1000),
      now,
    );
    return this.heatmapService.getDwellTimeHeatmap(
      req.tenantId,
      scope.branchId,
      start,
      end,
      {
        granularity: query.granularity,
      },
    );
  }

  @Get("traffic/flow")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Get traffic flow paths for visualization" })
  @ApiQuery({
    name: "startDate",
    required: false,
    description: "Start date (ISO format)",
  })
  @ApiQuery({
    name: "endDate",
    required: false,
    description: "End date (ISO format)",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "Max number of paths (default: 50)",
  })
  @ApiResponse({ status: 200, description: "Traffic flow paths" })
  async getTrafficFlow(
    @Request() req,
    @CurrentScope() scope: BranchScope,
    @Query() query: DateRangeDto,
    @Query("limit") limit?: string,
  ) {
    const now = new Date();
    const { start, end } = this.resolveRange(
      query,
      new Date(now.getTime() - 60 * 60 * 1000),
      now,
    );
    // Cap limit at 500 so a hostile caller can't pull every flow path in
    // one shot (each path carries a sequence of grid coordinates; large
    // pulls are both memory- and DB-heavy).
    const parsed = limit ? parseInt(limit, 10) : 50;
    const limitNum =
      Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : 50;
    return this.heatmapService.getTrafficFlowPaths(
      req.tenantId,
      scope.branchId,
      start,
      end,
      limitNum,
    );
  }

  @Get("traffic/congestion")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Get congestion analysis" })
  @ApiQuery({
    name: "startDate",
    required: false,
    description: "Start date (ISO format)",
  })
  @ApiQuery({
    name: "endDate",
    required: false,
    description: "End date (ISO format)",
  })
  @ApiResponse({ status: 200, description: "Congestion analysis" })
  async getCongestionAnalysis(
    @Request() req,
    @CurrentScope() scope: BranchScope,
    @Query() query: DateRangeDto,
  ) {
    const now = new Date();
    const { start, end } = this.resolveRange(
      query,
      new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      now,
    );
    return this.heatmapService.getCongestionAnalysis(
      req.tenantId,
      scope.branchId,
      start,
      end,
    );
  }

  // ==================== TABLE ANALYTICS ENDPOINTS ====================

  @Get("tables/utilization")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Get table utilization analytics" })
  @ApiQuery({
    name: "startDate",
    required: false,
    description: "Start date (ISO format)",
  })
  @ApiQuery({
    name: "endDate",
    required: false,
    description: "End date (ISO format)",
  })
  @ApiResponse({ status: 200, description: "Table utilization data" })
  async getTableUtilization(
    @Request() req,
    @CurrentScope() scope: BranchScope,
    @Query() query: DateRangeDto,
  ) {
    const now = new Date();
    const { start, end } = this.resolveRange(
      query,
      new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      now,
    );
    return this.tableAnalyticsService.getTableUtilization(
      req.tenantId,
      scope.branchId,
      start,
      end,
    );
  }

  @Get("tables/trends")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Get table utilization trends" })
  @ApiQuery({
    name: "startDate",
    required: false,
    description: "Start date (ISO format)",
  })
  @ApiQuery({
    name: "endDate",
    required: false,
    description: "End date (ISO format)",
  })
  @ApiResponse({ status: 200, description: "Utilization trends" })
  async getUtilizationTrends(
    @Request() req,
    @CurrentScope() scope: BranchScope,
    @Query() query: DateRangeDto,
  ) {
    const now = new Date();
    const { start, end } = this.resolveRange(
      query,
      new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      now,
    );
    return this.tableAnalyticsService.getUtilizationTrends(
      req.tenantId,
      scope.branchId,
      start,
      end,
    );
  }

  @Get("tables/underutilized")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Get underutilized tables" })
  @ApiQuery({
    name: "threshold",
    required: false,
    description: "Utilization threshold (default: 50)",
  })
  @ApiResponse({ status: 200, description: "Underutilized tables" })
  async getUnderutilizedTables(
    @Request() req,
    @CurrentScope() scope: BranchScope,
    @Query("threshold") threshold?: string,
  ) {
    // Threshold is a utilization-percentage cutoff (0-100). Clamp so a
    // bad string (NaN) or out-of-range value doesn't propagate into the
    // service's `where: { utilization: { lt: NaN } }` (which silently
    // matches nothing — same empty-list trap as the date case above).
    const parsed = threshold ? parseInt(threshold, 10) : 50;
    const thresholdNum = Number.isFinite(parsed)
      ? Math.min(100, Math.max(0, parsed))
      : 50;
    return this.tableAnalyticsService.getUnderutilizedTables(
      req.tenantId,
      scope.branchId,
      thresholdNum,
    );
  }

  @Get("customer-behavior")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Get customer behavior analytics" })
  @ApiQuery({
    name: "startDate",
    required: false,
    description: "Start date (ISO format)",
  })
  @ApiQuery({
    name: "endDate",
    required: false,
    description: "End date (ISO format)",
  })
  @ApiResponse({ status: 200, description: "Customer behavior data" })
  async getCustomerBehavior(
    @Request() req,
    @CurrentScope() scope: BranchScope,
    @Query() query: DateRangeDto,
  ) {
    const now = new Date();
    const { start, end } = this.resolveRange(
      query,
      new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      now,
    );
    return this.tableAnalyticsService.getCustomerBehavior(
      req.tenantId,
      scope.branchId,
      start,
      end,
    );
  }

  // ==================== INSIGHTS ENDPOINTS ====================

  @Get("insights")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Get AI-generated insights" })
  @ApiResponse({ status: 200, description: "List of insights" })
  async getInsights(
    @Request() req,
    @CurrentScope() scope: BranchScope,
    @Query() filters: InsightFilterDto,
  ) {
    return this.insightsService.getInsights(
      req.tenantId,
      scope.branchId,
      filters,
    );
  }

  @Get("insights/summary")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Get insights summary" })
  @ApiResponse({ status: 200, description: "Insights summary counts" })
  async getInsightsSummary(
    @Request() req,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.insightsService.getInsightSummary(req.tenantId, scope.branchId);
  }

  @Get("insights/actionable")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Get actionable insights" })
  @ApiResponse({ status: 200, description: "Actionable insights" })
  async getActionableInsights(
    @Request() req,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.insightsService.getActionableInsights(
      req.tenantId,
      scope.branchId,
    );
  }

  @Get("insights/:id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Get insight by ID" })
  @ApiParam({ name: "id", description: "Insight ID" })
  @ApiResponse({ status: 200, description: "Insight details" })
  async getInsightById(
    @Request() req,
    @CurrentScope() scope: BranchScope,
    @Param("id") id: string,
  ) {
    return this.insightsService.getInsightById(req.tenantId, scope.branchId, id);
  }

  @Put("insights/:id/status")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Update insight status" })
  @ApiParam({ name: "id", description: "Insight ID" })
  @ApiResponse({ status: 200, description: "Updated insight" })
  async updateInsightStatus(
    @Request() req,
    @CurrentScope() scope: BranchScope,
    @Param("id") id: string,
    @Body() dto: UpdateInsightStatusDto,
  ) {
    return this.insightsService.updateInsightStatus(
      req.tenantId,
      scope.branchId,
      id,
      req.user.id,
      dto,
    );
  }

  @Post("insights/generate")
  @Roles(UserRole.ADMIN)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Manually trigger insight generation" })
  @ApiResponse({ status: 200, description: "Number of insights generated" })
  async generateInsights(@Request() req, @CurrentScope() scope: BranchScope) {
    const count = await this.insightsService.generateInsights(
      req.tenantId,
      scope.branchId,
    );
    return { generated: count };
  }

  // ==================== CAMERA ENDPOINTS ====================

  @Get("cameras")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Get all cameras" })
  @ApiResponse({ status: 200, description: "List of cameras" })
  async getCameras(@CurrentScope() scope: BranchScope) {
    return this.cameraService.getCameras(scope);
  }

  @Get("cameras/health")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Get camera health summary" })
  @ApiResponse({ status: 200, description: "Camera health summary" })
  async getCameraHealth(@CurrentScope() scope: BranchScope) {
    return this.cameraService.getCameraHealthSummary(scope);
  }

  @Get("cameras/:id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Get camera by ID" })
  @ApiParam({ name: "id", description: "Camera ID" })
  @ApiResponse({ status: 200, description: "Camera details" })
  async getCameraById(
    @CurrentScope() scope: BranchScope,
    @Param("id") id: string,
  ) {
    return this.cameraService.getCameraById(scope, id);
  }

  @Post("cameras")
  @Roles(UserRole.ADMIN)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Create a new camera" })
  @ApiResponse({ status: 201, description: "Camera created" })
  async createCamera(
    @CurrentScope() scope: BranchScope,
    @Body() dto: CreateCameraDto,
  ) {
    return this.cameraService.createCamera(scope, dto);
  }

  @Put("cameras/:id")
  @Roles(UserRole.ADMIN)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Update camera" })
  @ApiParam({ name: "id", description: "Camera ID" })
  @ApiResponse({ status: 200, description: "Camera updated" })
  async updateCamera(
    @CurrentScope() scope: BranchScope,
    @Param("id") id: string,
    @Body() dto: UpdateCameraDto,
  ) {
    return this.cameraService.updateCamera(scope, id, dto);
  }

  @Delete("cameras/:id")
  @Roles(UserRole.ADMIN)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Delete camera" })
  @ApiParam({ name: "id", description: "Camera ID" })
  @ApiResponse({ status: 200, description: "Camera deleted" })
  async deleteCamera(
    @CurrentScope() scope: BranchScope,
    @Param("id") id: string,
  ) {
    await this.cameraService.deleteCamera(scope, id);
    return { success: true };
  }

  @Put("cameras/:id/calibration")
  @Roles(UserRole.ADMIN)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Update camera calibration" })
  @ApiParam({ name: "id", description: "Camera ID" })
  @ApiResponse({ status: 200, description: "Calibration updated" })
  async updateCameraCalibration(
    @Request() req,
    @Param("id") id: string,
    @Body() calibrationData: Record<string, unknown>,
  ) {
    return this.cameraService.updateCalibration(
      req.tenantId,
      id,
      calibrationData,
    );
  }

  // ==================== MOCK DATA ENDPOINTS (DEV ONLY) ====================

  private assertNotProduction() {
    if (process.env.NODE_ENV === "production") {
      throw new ForbiddenException(
        "Mock data endpoints are disabled in production",
      );
    }
  }

  @Post("mock-data/generate")
  @Roles(UserRole.ADMIN)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Generate mock analytics data (development only)" })
  @ApiQuery({
    name: "days",
    required: false,
    description: "Number of days to generate (default: 7)",
  })
  @ApiResponse({ status: 200, description: "Mock data generation results" })
  async generateMockData(
    @Request() req,
    @CurrentScope() scope: BranchScope,
    @Query("days") days?: string,
  ) {
    this.assertNotProduction();
    const daysNum = days ? parseInt(days, 10) : 7;
    return this.mockDataService.generateAllMockData(
      req.tenantId,
      scope.branchId,
      daysNum,
    );
  }

  @Delete("mock-data")
  @Roles(UserRole.ADMIN)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Clear all analytics data (development only)" })
  @ApiResponse({ status: 200, description: "Data cleared" })
  async clearMockData(@Request() req, @CurrentScope() scope: BranchScope) {
    this.assertNotProduction();
    await this.mockDataService.clearAnalyticsData(req.tenantId, scope.branchId);
    return { success: true };
  }
}
