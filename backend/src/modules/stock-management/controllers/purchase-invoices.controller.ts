import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { PurchaseInvoicesService } from "../services/purchase-invoices.service";
import { CreatePurchaseInvoiceDto } from "../dto/create-purchase-invoice.dto";
import { CurrentScope } from "../../auth/decorators/current-scope.decorator";
import { BranchScope } from "../../../common/scoping/branch-scope";

@ApiTags("stock-management/purchase-invoices")
@ApiBearerAuth()
@Controller("stock-management/purchase-invoices")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
@RequiresFeature(PlanFeature.INVENTORY_TRACKING)
export class PurchaseInvoicesController {
  constructor(private readonly service: PurchaseInvoicesService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: "Record a vendor bill (3-way matched if a PO is linked)",
  })
  create(
    @CurrentScope() scope: BranchScope,
    @Body() dto: CreatePurchaseInvoiceDto,
  ) {
    return this.service.create(scope, scope.userId, dto);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "List vendor bills" })
  list(
    @CurrentScope() scope: BranchScope,
    @Query("status") status?: string,
    @Query("supplierId") supplierId?: string,
  ) {
    return this.service.list(scope, { status, supplierId });
  }

  @Get(":id/match")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: "3-way match breakdown (ordered/received/invoiced)",
  })
  getMatch(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.service.getMatch(scope, id);
  }

  @Patch(":id/approve")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Approve a bill for payment" })
  approve(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.service.approve(scope, id);
  }

  @Patch(":id/mark-paid")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Mark an approved bill as paid" })
  markPaid(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.service.markPaid(scope, id);
  }
}
