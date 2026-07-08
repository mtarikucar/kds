import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { ReportsService } from "./reports.service";
import { SalesReportDto } from "./dto/sales-report.dto";
import { TopProductsReportDto } from "./dto/top-products.dto";
import {
  DateRangeQueryDto,
  SingleDateQueryDto,
  TopProductsQueryDto,
} from "./dto/query.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { PlanFeatureGuard } from "../subscriptions/guards/plan-feature.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { RequiresFeature } from "../subscriptions/decorators/requires-feature.decorator";
import { UserRole } from "../../common/constants/roles.enum";
import { PlanFeature } from "../../common/constants/subscription.enum";

@ApiTags("reports")
@ApiBearerAuth()
@Controller("reports")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /**
   * Resolve which branch a report may read.
   * - Wildcard ADMIN (empty allowedBranchIds = full tenant access): any branch,
   *   or tenant-wide when branchId is omitted.
   * - Everyone else (MANAGER, or an ADMIN narrowed to specific branches): an
   *   explicitly-requested branchId is honored ONLY if it's in their allow-list;
   *   otherwise they're locked to the branch BranchGuard validated (req.scope).
   * A caller-supplied query.branchId can never widen access beyond the allow-list.
   */
  private branchFor(
    req: any,
    query: { branchId?: string },
  ): string | undefined {
    const scope = req.scope;
    const allowed: string[] = req.user?.allowedBranchIds ?? [];
    const isWildcardAdmin =
      scope?.role === UserRole.ADMIN && allowed.length === 0;
    if (isWildcardAdmin) return query.branchId;
    if (query.branchId && allowed.includes(query.branchId)) {
      return query.branchId;
    }
    return scope?.branchId;
  }

  @Get("sales")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Get sales summary report (ADMIN, MANAGER)" })
  @ApiResponse({ status: 200, type: SalesReportDto })
  async getSalesSummary(@Request() req, @Query() query: DateRangeQueryDto) {
    const start = query.startDate ? new Date(query.startDate) : undefined;
    const end = query.endDate ? new Date(query.endDate) : undefined;
    return this.reportsService.getSalesSummary(
      req.tenantId,
      start,
      end,
      this.branchFor(req, query),
    );
  }

  @Get("sales-comparison")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({
    summary:
      "Sales vs the previous equal-length window (MoM/period-over-period)",
  })
  async getSalesComparison(@Request() req, @Query() query: DateRangeQueryDto) {
    const start = query.startDate ? new Date(query.startDate) : undefined;
    const end = query.endDate ? new Date(query.endDate) : undefined;
    return this.reportsService.getSalesComparison(
      req.tenantId,
      start,
      end,
      this.branchFor(req, query),
    );
  }

  @Get("sales.csv")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="sales.csv"')
  @ApiOperation({ summary: "Daily sales breakdown as CSV (accountant export)" })
  async getSalesCsv(@Request() req, @Query() query: DateRangeQueryDto) {
    const start = query.startDate ? new Date(query.startDate) : undefined;
    const end = query.endDate ? new Date(query.endDate) : undefined;
    return this.reportsService.getSalesSummaryCsv(
      req.tenantId,
      start,
      end,
      this.branchFor(req, query),
    );
  }

  @Get("top-products")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Get top selling products (ADMIN, MANAGER)" })
  @ApiResponse({ status: 200, type: TopProductsReportDto })
  async getTopProducts(@Request() req, @Query() query: TopProductsQueryDto) {
    const start = query.startDate ? new Date(query.startDate) : undefined;
    const end = query.endDate ? new Date(query.endDate) : undefined;
    return this.reportsService.getTopProducts(
      req.tenantId,
      start,
      end,
      query.limit ?? 10,
      this.branchFor(req, query),
    );
  }

  @Get("payments")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Get payment method breakdown (ADMIN, MANAGER)" })
  async getPaymentMethodBreakdown(
    @Request() req,
    @Query() query: DateRangeQueryDto,
  ) {
    const start = query.startDate ? new Date(query.startDate) : undefined;
    const end = query.endDate ? new Date(query.endDate) : undefined;
    return this.reportsService.getPaymentMethodBreakdown(
      req.tenantId,
      start,
      end,
      this.branchFor(req, query),
    );
  }

  @Get("orders-by-hour")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Get orders grouped by hour (ADMIN, MANAGER)" })
  async getOrdersByHour(@Request() req, @Query() query: SingleDateQueryDto) {
    const targetDate = query.date ? new Date(query.date) : undefined;
    return this.reportsService.getOrdersByHour(
      req.tenantId,
      targetDate,
      this.branchFor(req, query),
    );
  }

  @Get("customers")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Get customer analytics report (ADMIN, MANAGER)" })
  async getCustomerAnalytics(
    @Request() req,
    @Query() query: DateRangeQueryDto,
  ) {
    const start = query.startDate ? new Date(query.startDate) : undefined;
    const end = query.endDate ? new Date(query.endDate) : undefined;
    return this.reportsService.getCustomerAnalytics(
      req.tenantId,
      start,
      end,
      this.branchFor(req, query),
    );
  }

  @Get("cogs")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({
    summary: "COGS + food-cost % + gross margin from the movement ledger",
  })
  async getCogsReport(@Request() req, @Query() query: DateRangeQueryDto) {
    const start = query.startDate ? new Date(query.startDate) : undefined;
    const end = query.endDate ? new Date(query.endDate) : undefined;
    return this.reportsService.getCogsReport(
      req.tenantId,
      start,
      end,
      this.branchFor(req, query),
    );
  }

  @Get("tips")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Tips report: total + per-tender breakdown" })
  async getTipsReport(@Request() req, @Query() query: DateRangeQueryDto) {
    const start = query.startDate ? new Date(query.startDate) : undefined;
    const end = query.endDate ? new Date(query.endDate) : undefined;
    return this.reportsService.getTipsReport(
      req.tenantId,
      start,
      end,
      this.branchFor(req, query),
    );
  }

  @Get("tip-distribution")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Tip pool (tronc) distribution by hours worked" })
  async getTipDistribution(@Request() req, @Query() query: DateRangeQueryDto) {
    const start = query.startDate ? new Date(query.startDate) : undefined;
    const end = query.endDate ? new Date(query.endDate) : undefined;
    const pool =
      (query as any).pool != null ? parseFloat((query as any).pool) : undefined;
    return this.reportsService.getTipDistribution(
      req.tenantId,
      start,
      end,
      this.branchFor(req, query),
      pool,
    );
  }

  @Get("profit-and-loss")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({
    summary: "P&L: revenue − COGS − operating expenses → net profit",
  })
  async getProfitAndLoss(@Request() req, @Query() query: DateRangeQueryDto) {
    const start = query.startDate ? new Date(query.startDate) : undefined;
    const end = query.endDate ? new Date(query.endDate) : undefined;
    return this.reportsService.getProfitAndLoss(
      req.tenantId,
      start,
      end,
      this.branchFor(req, query),
    );
  }

  @Get("sales-forecast")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({
    summary: "Sales forecast (weekday-average projection of the next N days)",
  })
  async getSalesForecast(@Request() req, @Query() query: DateRangeQueryDto) {
    return this.reportsService.getSalesForecast(
      req.tenantId,
      7,
      this.branchFor(req, query),
    );
  }

  @Get("consolidated-pnl")
  // Tenant-wide (every branch) — WILDCARD ADMIN only. A branch-restricted
  // MANAGER or a narrowed ADMIN (non-empty allowedBranchIds) must not read
  // sibling branches' financials via the consolidated view.
  @Roles(UserRole.ADMIN)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({
    summary: "Consolidated P&L across all branches (full-access ADMIN)",
  })
  async getConsolidatedPnl(@Request() req, @Query() query: DateRangeQueryDto) {
    if ((req.user?.allowedBranchIds ?? []).length > 0) {
      throw new ForbiddenException(
        "Consolidated P&L is available only to full-tenant admins",
      );
    }
    const start = query.startDate ? new Date(query.startDate) : undefined;
    const end = query.endDate ? new Date(query.endDate) : undefined;
    return this.reportsService.getConsolidatedPnl(req.tenantId, start, end);
  }

  @Get("labor")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({
    summary:
      "Labor cost + prime cost (COGS + labor) + labor % / sales-per-hour",
  })
  async getLaborReport(@Request() req, @Query() query: DateRangeQueryDto) {
    const start = query.startDate ? new Date(query.startDate) : undefined;
    const end = query.endDate ? new Date(query.endDate) : undefined;
    return this.reportsService.getLaborReport(
      req.tenantId,
      start,
      end,
      this.branchFor(req, query),
    );
  }

  @Get("menu-engineering")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({
    summary:
      "Menu engineering: Star/Plow-horse/Puzzle/Dog + contribution margin",
  })
  async getMenuEngineering(@Request() req, @Query() query: DateRangeQueryDto) {
    const start = query.startDate ? new Date(query.startDate) : undefined;
    const end = query.endDate ? new Date(query.endDate) : undefined;
    return this.reportsService.getMenuEngineering(
      req.tenantId,
      start,
      end,
      this.branchFor(req, query),
    );
  }

  @Get("inventory")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.INVENTORY_TRACKING)
  @ApiOperation({ summary: "Get inventory report (ADMIN, MANAGER)" })
  async getInventoryReport(@Request() req) {
    return this.reportsService.getInventoryReport(req.tenantId);
  }

  @Get("staff-performance")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: "Get staff performance report (ADMIN, MANAGER)" })
  async getStaffPerformance(@Request() req, @Query() query: DateRangeQueryDto) {
    const start = query.startDate ? new Date(query.startDate) : undefined;
    const end = query.endDate ? new Date(query.endDate) : undefined;
    return this.reportsService.getStaffPerformance(
      req.tenantId,
      start,
      end,
      this.branchFor(req, query),
    );
  }
}
