import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { OrdersService } from '../services/orders.service';
import { CreateOrderDto } from '../dto/create-order.dto';
import { UpdateOrderDto } from '../dto/update-order.dto';
import { UpdateOrderStatusDto } from '../dto/update-order-status.dto';
import { TransferTableOrdersDto } from '../dto/transfer-table.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { OrderStatus } from '../../../common/constants/order-status.enum';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: 'Create a new order (ADMIN, MANAGER, WAITER)' })
  @ApiResponse({ status: 201, description: 'Order successfully created' })
  @ApiResponse({ status: 400, description: 'Invalid data' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  create(@Body() createOrderDto: CreateOrderDto, @Request() req) {
    return this.ordersService.create(createOrderDto, req.user.id, req.tenantId);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: 'Get all orders (ADMIN, MANAGER, WAITER)' })
  @ApiQuery({ name: 'tableId', required: false, description: 'Filter by table ID' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status (comma-separated for multiple: PENDING,PREPARING,READY)' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Filter by start date (ISO format)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'Filter by end date (ISO format)' })
  @ApiResponse({ status: 200, description: 'List of all orders' })
  findAll(
    @Request() req,
    @Query('tableId') tableId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;

    // Convert comma-separated status string to array
    const statuses = status ? status.split(',').map(s => s.trim()) as OrderStatus[] : undefined;

    console.log('[Orders Controller] Query params:', { tableId, status, statuses });

    return this.ordersService.findAll(req.tenantId, tableId, statuses, start, end);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: 'Get an order by ID (ADMIN, MANAGER, WAITER)' })
  @ApiResponse({ status: 200, description: 'Order details' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.ordersService.findOne(id, req.tenantId);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: 'Update an order (ADMIN, MANAGER, WAITER)' })
  @ApiResponse({ status: 200, description: 'Order successfully updated' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({ status: 400, description: 'Cannot update paid or cancelled orders' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  update(
    @Param('id') id: string,
    @Body() updateOrderDto: UpdateOrderDto,
    @Request() req,
  ) {
    return this.ordersService.update(id, updateOrderDto, req.tenantId);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: 'Update order status (ADMIN, MANAGER, WAITER)' })
  @ApiResponse({ status: 200, description: 'Order status successfully updated' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  updateStatus(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateOrderStatusDto,
    @Request() req,
  ) {
    return this.ordersService.updateStatus(id, updateStatusDto, req.tenantId);
  }

  @Post('transfer-table')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: 'Transfer orders from one table to another (ADMIN, MANAGER, WAITER)' })
  @ApiResponse({ status: 200, description: 'Orders successfully transferred' })
  @ApiResponse({ status: 400, description: 'Invalid transfer request' })
  @ApiResponse({ status: 404, description: 'Source or target table not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  transferTableOrders(@Body() dto: TransferTableOrdersDto, @Request() req) {
    return this.ordersService.transferTableOrders(dto, req.tenantId);
  }

  @Post(':id/approve')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: 'Approve a pending customer order (ADMIN, MANAGER, WAITER)' })
  @ApiResponse({ status: 200, description: 'Order successfully approved' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({ status: 400, description: 'Order is not pending approval' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  approveOrder(@Param('id') id: string, @Request() req) {
    return this.ordersService.approveOrder(id, req.user.id, req.tenantId);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Delete an order (ADMIN, MANAGER)' })
  @ApiResponse({ status: 200, description: 'Order successfully deleted' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({ status: 400, description: 'Can only delete pending or cancelled orders' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  remove(@Param('id') id: string, @Request() req) {
    return this.ordersService.remove(id, req.tenantId);
  }
}
