import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { TenantGuard } from "../../auth/guards/tenant.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { UserRole } from "../../../common/constants/roles.enum";
import { PlanFeatureGuard } from "../../subscriptions/guards/plan-feature.guard";
import { RequiresFeature } from "../../subscriptions/decorators/requires-feature.decorator";
import { PlanFeature } from "../../../common/constants/subscription.enum";
import { PurchaseOrdersService } from "../services/purchase-orders.service";
import { CreatePurchaseOrderDto } from "../dto/create-purchase-order.dto";
import { ReceivePurchaseOrderDto } from "../dto/receive-purchase-order.dto";
import { CurrentScope } from "../../auth/decorators/current-scope.decorator";
import { BranchScope } from "../../../common/scoping/branch-scope";

@ApiTags("stock-management/purchase-orders")
@ApiBearerAuth()
@Controller("stock-management/purchase-orders")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
@RequiresFeature(PlanFeature.INVENTORY_TRACKING)
export class PurchaseOrdersController {
  constructor(private readonly service: PurchaseOrdersService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Get all purchase orders" })
  @ApiQuery({ name: "status", required: false })
  findAll(
    @CurrentScope() scope: BranchScope,
    @Query("status") status?: string,
  ) {
    return this.service.findAll(scope, status);
  }

  @Get(":id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Get a purchase order by ID" })
  findOne(@Param("id") id: string, @CurrentScope() scope: BranchScope) {
    return this.service.findOne(id, scope);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Create a purchase order" })
  create(
    @Body() dto: CreatePurchaseOrderDto,
    @CurrentScope() scope: BranchScope,
    @Request() req,
  ) {
    return this.service.create(
      dto,
      scope.tenantId,
      scope.branchId,
      req.user?.id,
    );
  }

  @Post(":id/submit")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Submit a draft purchase order" })
  submit(@Param("id") id: string, @CurrentScope() scope: BranchScope) {
    return this.service.submit(id, scope);
  }

  @Post(":id/approve")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: "Approve a purchase order awaiting approval (over threshold)",
  })
  approve(@Param("id") id: string, @CurrentScope() scope: BranchScope) {
    return this.service.approve(id, scope, scope.userId);
  }

  @Post(":id/receive")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Receive items against a purchase order" })
  receive(
    @Param("id") id: string,
    @Body() dto: ReceivePurchaseOrderDto,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.service.receive(id, dto, scope, scope.userId);
  }

  @Post(":id/cancel")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Cancel a purchase order" })
  cancel(@Param("id") id: string, @CurrentScope() scope: BranchScope) {
    return this.service.cancel(id, scope, scope.userId);
  }
}
