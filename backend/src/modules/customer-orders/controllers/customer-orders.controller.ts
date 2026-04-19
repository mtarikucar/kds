import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { CustomerOrdersService } from '../services/customer-orders.service';
import { CreateCustomerOrderDto } from '../dto/create-customer-order.dto';
import {
  CreateBillRequestDto,
  CreateWaiterRequestDto,
} from '../dto/waiter-request.dto';

/**
 * QR-menu / customer-facing endpoints. Every public mutation resolves tenantId
 * from the server-side CustomerSession row; the request body MUST NOT supply
 * tenantId. Paired with per-endpoint @Throttle because there is no auth wall
 * in front of these routes.
 */
@ApiTags('Customer Orders')
@Controller('customer-orders')
export class CustomerOrdersController {
  constructor(private readonly customerOrdersService: CustomerOrdersService) {}

  // ========================================
  // CUSTOMER ORDERS (Public endpoints)
  // ========================================

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  @ApiOperation({ summary: 'Create a new customer order' })
  @ApiResponse({ status: 201, description: 'Order created successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired session' })
  async createOrder(@Body() dto: CreateCustomerOrderDto) {
    return this.customerOrdersService.createOrder(dto);
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('session/:sessionId')
  @ApiOperation({ summary: 'Get all orders for a session' })
  async getSessionOrders(@Param('sessionId') sessionId: string) {
    return this.customerOrdersService.getSessionOrders(sessionId);
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':orderId')
  @ApiOperation({ summary: 'Get order details by ID' })
  async getOrderById(
    @Param('orderId') orderId: string,
    @Query('sessionId') sessionId: string,
  ) {
    return this.customerOrdersService.getOrderById(orderId, sessionId);
  }

  // ========================================
  // WAITER REQUESTS (Public endpoints)
  // ========================================

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('waiter-requests')
  @ApiOperation({ summary: 'Create a waiter request' })
  async createWaiterRequest(@Body() dto: CreateWaiterRequestDto) {
    return this.customerOrdersService.createWaiterRequest(dto);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('waiter-requests/session/:sessionId')
  @ApiOperation({ summary: 'Get all waiter requests for a session' })
  async getSessionWaiterRequests(@Param('sessionId') sessionId: string) {
    return this.customerOrdersService.getSessionWaiterRequests(sessionId);
  }

  // ========================================
  // BILL REQUESTS (Public endpoints)
  // ========================================

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('bill-requests')
  @ApiOperation({ summary: 'Create a bill request' })
  async createBillRequest(@Body() dto: CreateBillRequestDto) {
    return this.customerOrdersService.createBillRequest(dto);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('bill-requests/session/:sessionId')
  @ApiOperation({ summary: 'Get all bill requests for a session' })
  async getSessionBillRequests(@Param('sessionId') sessionId: string) {
    return this.customerOrdersService.getSessionBillRequests(sessionId);
  }

  // ========================================
  // STAFF ENDPOINTS (Protected)
  // ========================================

  @Get('waiter-requests/tenant/active')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all active waiter requests for tenant (STAFF)' })
  async getActiveWaiterRequests(@Request() req) {
    return this.customerOrdersService.getActiveWaiterRequests(req.tenantId);
  }

  @Patch('waiter-requests/:id/acknowledge')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Acknowledge a waiter request (STAFF)' })
  async acknowledgeWaiterRequest(@Param('id') id: string, @Request() req) {
    return this.customerOrdersService.acknowledgeWaiterRequest(id, req.user.id, req.tenantId);
  }

  @Patch('waiter-requests/:id/complete')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark a waiter request as completed (STAFF)' })
  async completeWaiterRequest(@Param('id') id: string, @Request() req) {
    return this.customerOrdersService.completeWaiterRequest(id, req.user.id, req.tenantId);
  }

  @Get('bill-requests/tenant/active')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all active bill requests for tenant (STAFF)' })
  async getActiveBillRequests(@Request() req) {
    return this.customerOrdersService.getActiveBillRequests(req.tenantId);
  }

  @Patch('bill-requests/:id/acknowledge')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Acknowledge a bill request (STAFF)' })
  async acknowledgeBillRequest(@Param('id') id: string, @Request() req) {
    return this.customerOrdersService.acknowledgeBillRequest(id, req.user.id, req.tenantId);
  }

  @Patch('bill-requests/:id/complete')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark a bill request as completed (STAFF)' })
  async completeBillRequest(@Param('id') id: string, @Request() req) {
    return this.customerOrdersService.completeBillRequest(id, req.user.id, req.tenantId);
  }
}
