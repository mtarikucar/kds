import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { StockTransferService } from "../services/stock-transfer.service";
import { CreateStockTransferDto } from "../dto/create-stock-transfer.dto";
import { CurrentScope } from "../../auth/decorators/current-scope.decorator";
import { BranchScope } from "../../../common/scoping/branch-scope";

@ApiTags("stock-management/transfers")
@ApiBearerAuth()
@Controller("stock-management/transfers")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
@RequiresFeature(PlanFeature.INVENTORY_TRACKING)
export class StockTransferController {
  constructor(private readonly service: StockTransferService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Create an inter-branch stock transfer (PENDING)" })
  create(
    @CurrentScope() scope: BranchScope,
    @Body() dto: CreateStockTransferDto,
    @Request() req: any,
  ) {
    // Narrowed users may only transfer INTO branches on their allow-list
    // (empty list = wildcard ADMIN) — see service create() for why.
    return this.service.create(
      scope,
      scope.userId,
      dto,
      req.user?.allowedBranchIds ?? [],
    );
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "List transfers touching this branch" })
  list(@CurrentScope() scope: BranchScope) {
    return this.service.list(scope);
  }

  @Patch(":id/complete")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Complete a transfer — moves the stock atomically" })
  complete(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.service.complete(scope, id);
  }

  @Patch(":id/cancel")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Cancel a pending transfer" })
  cancel(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.service.cancel(scope, id);
  }
}
