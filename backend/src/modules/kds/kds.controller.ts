import { Controller, Get, Patch, Param, Body, UseGuards } from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from "@nestjs/swagger";
import { KdsService } from "./kds.service";
import { UpdateOrderItemStatusDto } from "./dto/update-order-item-status.dto";
import { UpdateOrderStatusDto } from "../orders/dto/update-order-status.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../../common/constants/roles.enum";
import { CurrentScope } from "../auth/decorators/current-scope.decorator";
import { BranchScope } from "../../common/scoping/branch-scope";

@ApiTags("kds")
@ApiBearerAuth()
@Controller("kds")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class KdsController {
  constructor(private readonly kdsService: KdsService) {}

  @Get("orders")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN)
  @ApiOperation({ summary: "Get all kitchen orders (ADMIN, MANAGER, KITCHEN)" })
  @ApiResponse({ status: 200, description: "List of kitchen orders" })
  @ApiResponse({ status: 403, description: "Insufficient permissions" })
  getKitchenOrders(@CurrentScope() scope: BranchScope) {
    return this.kdsService.getKitchenOrders(scope);
  }

  @Patch("orders/:id/status")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN)
  @ApiOperation({ summary: "Update order status (ADMIN, MANAGER, KITCHEN)" })
  @ApiResponse({ status: 200, description: "Order status updated" })
  @ApiResponse({ status: 404, description: "Order not found" })
  @ApiResponse({ status: 403, description: "Insufficient permissions" })
  updateOrderStatus(
    @Param("id") id: string,
    @Body() updateStatusDto: UpdateOrderStatusDto,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.kdsService.updateOrderStatus(scope, id, updateStatusDto.status);
  }

  @Patch("order-items/:id/status")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN)
  @ApiOperation({
    summary: "Update order item status (ADMIN, MANAGER, KITCHEN)",
  })
  @ApiResponse({ status: 200, description: "Order item status updated" })
  @ApiResponse({ status: 404, description: "Order item not found" })
  @ApiResponse({ status: 403, description: "Insufficient permissions" })
  updateOrderItemStatus(
    @Param("id") id: string,
    @Body() updateDto: UpdateOrderItemStatusDto,
    @CurrentScope() scope: BranchScope,
  ) {
    // Iter-91: the item id comes from the URL path, not the body — the
    // previous DTO duplicated the field in both places and the service
    // trusted the body, which let a client desync URL vs target item.
    return this.kdsService.updateOrderItemStatus(scope, id, updateDto.status);
  }

  @Patch("orders/:id/cancel")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN)
  @ApiOperation({ summary: "Cancel an order (ADMIN, MANAGER, KITCHEN)" })
  @ApiResponse({ status: 200, description: "Order cancelled successfully" })
  @ApiResponse({ status: 404, description: "Order not found" })
  @ApiResponse({ status: 400, description: "Cannot cancel paid orders" })
  @ApiResponse({ status: 403, description: "Insufficient permissions" })
  cancelOrder(@Param("id") id: string, @CurrentScope() scope: BranchScope) {
    return this.kdsService.cancelOrder(scope, id);
  }
}
