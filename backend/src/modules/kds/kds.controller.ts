import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { KdsService } from './kds.service';
import { UpdateOrderItemStatusDto } from './dto/update-order-item-status.dto';
import { UpdateOrderStatusDto } from '../orders/dto/update-order-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles.enum';

@ApiTags('kds')
@ApiBearerAuth()
@Controller('kds')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class KdsController {
  constructor(private readonly kdsService: KdsService) {}

  @Get('orders')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN)
  @ApiOperation({ summary: 'Get all kitchen orders (ADMIN, MANAGER, KITCHEN)' })
  @ApiResponse({ status: 200, description: 'List of kitchen orders' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  getKitchenOrders(@Request() req) {
    return this.kdsService.getKitchenOrders(req.tenantId);
  }

  @Patch('orders/:id/status')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN)
  @ApiOperation({ summary: 'Update order status (ADMIN, MANAGER, KITCHEN)' })
  @ApiResponse({ status: 200, description: 'Order status updated' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  updateOrderStatus(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateOrderStatusDto,
    @Request() req,
  ) {
    return this.kdsService.updateOrderStatus(id, updateStatusDto.status, req.tenantId);
  }

  @Patch('order-items/:id/status')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN)
  @ApiOperation({ summary: 'Update order item status (ADMIN, MANAGER, KITCHEN)' })
  @ApiResponse({ status: 200, description: 'Order item status updated' })
  @ApiResponse({ status: 404, description: 'Order item not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  updateOrderItemStatus(
    @Param('id') id: string,
    @Body() updateDto: UpdateOrderItemStatusDto,
    @Request() req,
  ) {
    return this.kdsService.updateOrderItemStatus(id, updateDto, req.tenantId);
  }
}
