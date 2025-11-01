import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Patch,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { CustomerOrdersService } from '../services/customer-orders.service';
import { CreateCustomerOrderDto } from '../dto/create-customer-order.dto';
import { CreateWaiterRequestDto, CreateBillRequestDto } from '../dto/waiter-request.dto';

@ApiTags('Customer Orders')
@Controller('customer-orders')
export class CustomerOrdersController {
  constructor(private readonly customerOrdersService: CustomerOrdersService) {}

  // ========================================
  // CUSTOMER ORDERS (Public endpoints)
  // ========================================

  @Public()
  @Post()
  @ApiOperation({ summary: 'Create a new customer order (no authentication required)' })
  @ApiResponse({ status: 201, description: 'Order created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid order data' })
  @ApiResponse({ status: 404, description: 'Tenant or table not found' })
  async createOrder(@Body() dto: CreateCustomerOrderDto) {
    return this.customerOrdersService.createOrder(dto);
  }

  @Public()
  @Get('session/:sessionId')
  @ApiOperation({ summary: 'Get all orders for a session (no authentication required)' })
  @ApiResponse({ status: 200, description: 'Session orders retrieved' })
  async getSessionOrders(
    @Param('sessionId') sessionId: string,
    @Query('tenantId') tenantId: string
  ) {
    return this.customerOrdersService.getSessionOrders(sessionId, tenantId);
  }

  @Public()
  @Get(':orderId')
  @ApiOperation({ summary: 'Get order details by ID (no authentication required)' })
  @ApiResponse({ status: 200, description: 'Order details retrieved' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async getOrderById(
    @Param('orderId') orderId: string,
    @Query('sessionId') sessionId: string
  ) {
    return this.customerOrdersService.getOrderById(orderId, sessionId);
  }

  // ========================================
  // WAITER REQUESTS (Public endpoints)
  // ========================================

  @Public()
  @Post('waiter-requests')
  @ApiOperation({ summary: 'Create a waiter request (no authentication required)' })
  @ApiResponse({ status: 201, description: 'Waiter request created' })
  @ApiResponse({ status: 404, description: 'Table not found' })
  async createWaiterRequest(@Body() dto: CreateWaiterRequestDto) {
    return this.customerOrdersService.createWaiterRequest(dto);
  }

  @Public()
  @Get('waiter-requests/session/:sessionId')
  @ApiOperation({ summary: 'Get all waiter requests for a session (no authentication required)' })
  @ApiResponse({ status: 200, description: 'Waiter requests retrieved' })
  async getSessionWaiterRequests(
    @Param('sessionId') sessionId: string,
    @Query('tenantId') tenantId: string
  ) {
    return this.customerOrdersService.getSessionWaiterRequests(sessionId, tenantId);
  }

  // ========================================
  // BILL REQUESTS (Public endpoints)
  // ========================================

  @Public()
  @Post('bill-requests')
  @ApiOperation({ summary: 'Create a bill request (no authentication required)' })
  @ApiResponse({ status: 201, description: 'Bill request created' })
  @ApiResponse({ status: 404, description: 'Table not found' })
  async createBillRequest(@Body() dto: CreateBillRequestDto) {
    return this.customerOrdersService.createBillRequest(dto);
  }

  @Public()
  @Get('bill-requests/session/:sessionId')
  @ApiOperation({ summary: 'Get all bill requests for a session (no authentication required)' })
  @ApiResponse({ status: 200, description: 'Bill requests retrieved' })
  async getSessionBillRequests(
    @Param('sessionId') sessionId: string,
    @Query('tenantId') tenantId: string
  ) {
    return this.customerOrdersService.getSessionBillRequests(sessionId, tenantId);
  }

  // ========================================
  // STAFF ENDPOINTS (Protected)
  // ========================================

  @Get('waiter-requests/tenant/active')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all active waiter requests for tenant (STAFF)' })
  @ApiResponse({ status: 200, description: 'Active waiter requests retrieved' })
  async getActiveWaiterRequests(@Request() req) {
    return this.customerOrdersService.getActiveWaiterRequests(req.tenantId);
  }

  @Patch('waiter-requests/:id/acknowledge')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Acknowledge a waiter request (STAFF)' })
  @ApiResponse({ status: 200, description: 'Waiter request acknowledged' })
  async acknowledgeWaiterRequest(
    @Param('id') id: string,
    @Request() req
  ) {
    return this.customerOrdersService.acknowledgeWaiterRequest(id, req.user.id, req.tenantId);
  }

  @Patch('waiter-requests/:id/complete')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark a waiter request as completed (STAFF)' })
  @ApiResponse({ status: 200, description: 'Waiter request completed' })
  async completeWaiterRequest(
    @Param('id') id: string,
    @Request() req
  ) {
    return this.customerOrdersService.completeWaiterRequest(id, req.user.id, req.tenantId);
  }

  @Get('bill-requests/tenant/active')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all active bill requests for tenant (STAFF)' })
  @ApiResponse({ status: 200, description: 'Active bill requests retrieved' })
  async getActiveBillRequests(@Request() req) {
    return this.customerOrdersService.getActiveBillRequests(req.tenantId);
  }

  @Patch('bill-requests/:id/acknowledge')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Acknowledge a bill request (STAFF)' })
  @ApiResponse({ status: 200, description: 'Bill request acknowledged' })
  async acknowledgeBillRequest(
    @Param('id') id: string,
    @Request() req
  ) {
    return this.customerOrdersService.acknowledgeBillRequest(id, req.user.id, req.tenantId);
  }

  @Patch('bill-requests/:id/complete')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark a bill request as completed (STAFF)' })
  @ApiResponse({ status: 200, description: 'Bill request completed' })
  async completeBillRequest(
    @Param('id') id: string,
    @Request() req
  ) {
    return this.customerOrdersService.completeBillRequest(id, req.user.id, req.tenantId);
  }
}
