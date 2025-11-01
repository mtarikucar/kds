import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
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
}
