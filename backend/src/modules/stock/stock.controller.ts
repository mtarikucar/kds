import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { StockService } from './stock.service';
import { CreateStockMovementDto } from './dto/create-stock-movement.dto';
import { StockAlertDto } from './dto/stock-alert.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles.enum';
import { StockMovementType } from '../../common/constants/order-status.enum';

@ApiTags('stock')
@ApiBearerAuth()
@Controller('stock')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Post('movements')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a stock movement (ADMIN, MANAGER)' })
  @ApiResponse({ status: 201, description: 'Stock movement created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid data or insufficient stock' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  createMovement(@Body() createDto: CreateStockMovementDto, @Request() req) {
    return this.stockService.createMovement(createDto, req.user.userId, req.tenantId);
  }

  @Get('movements')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get stock movements (ADMIN, MANAGER)' })
  @ApiQuery({ name: 'productId', required: false, description: 'Filter by product ID' })
  @ApiQuery({ name: 'type', required: false, enum: StockMovementType, description: 'Filter by movement type' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Filter by start date (ISO format)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'Filter by end date (ISO format)' })
  @ApiResponse({ status: 200, description: 'List of stock movements' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  getMovements(
    @Request() req,
    @Query('productId') productId?: string,
    @Query('type') type?: StockMovementType,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.stockService.getMovements(req.tenantId, productId, type, start, end);
  }

  @Get('alerts')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get low stock alerts (ADMIN, MANAGER)' })
  @ApiQuery({ name: 'threshold', required: false, description: 'Stock threshold (default: 10)' })
  @ApiResponse({ status: 200, description: 'List of low stock products', type: [StockAlertDto] })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  getLowStockAlerts(@Request() req, @Query('threshold') threshold?: string) {
    const thresholdNum = threshold ? parseInt(threshold, 10) : 10;
    return this.stockService.getLowStockAlerts(req.tenantId, thresholdNum);
  }
}
