import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { TenantGuard } from "../../auth/guards/tenant.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { UserRole } from "../../../common/constants/roles.enum";
import { PlanFeatureGuard } from "../../subscriptions/guards/plan-feature.guard";
import { RequiresFeature } from "../../subscriptions/decorators/requires-feature.decorator";
import { PlanFeature } from "../../../common/constants/subscription.enum";
import { WasteLogsService } from "../services/waste-logs.service";
import { CreateWasteLogDto } from "../dto/create-waste-log.dto";
import {
  ListWasteLogsQueryDto,
  WasteLogsSummaryQueryDto,
} from "../dto/list-stock-logs.dto";
import { CurrentScope } from "../../auth/decorators/current-scope.decorator";
import { BranchScope } from "../../../common/scoping/branch-scope";

@ApiTags("stock-management/waste-logs")
@ApiBearerAuth()
@Controller("stock-management/waste-logs")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
@RequiresFeature(PlanFeature.INVENTORY_TRACKING)
export class WasteLogsController {
  constructor(private readonly service: WasteLogsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN)
  @ApiOperation({ summary: "Get all waste logs" })
  findAll(
    @CurrentScope() scope: BranchScope,
    @Query() query: ListWasteLogsQueryDto,
  ) {
    return this.service.findAll(scope, query);
  }

  @Get("summary")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Get waste summary with totals by reason" })
  getSummary(
    @CurrentScope() scope: BranchScope,
    @Query() query: WasteLogsSummaryQueryDto,
  ) {
    return this.service.getSummary(scope, query.startDate, query.endDate);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN)
  @ApiOperation({ summary: "Log waste" })
  create(
    @Body() dto: CreateWasteLogDto,
    @Request() req,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.service.create(dto, scope, req.user?.id);
  }
}
