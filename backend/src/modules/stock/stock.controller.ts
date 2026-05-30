import {
  BadRequestException,
  Body,
  Controller,
  Get,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
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
import { PlanFeatureGuard } from '../subscriptions/guards/plan-feature.guard';
import { RequiresFeature } from '../subscriptions/decorators/requires-feature.decorator';
import { PlanFeature } from '../../common/constants/subscription.enum';

// v2.8.90 — legacy /stock surface lacked @RequiresFeature(INVENTORY_TRACKING)
// so FREE plan tenants could create stock movements / query alerts that
// the gated /stock-management module otherwise blocks. Same gate added
// here so the legacy surface follows the same rules.
@ApiTags('stock')
@ApiBearerAuth()
@Controller('stock')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
@RequiresFeature(PlanFeature.INVENTORY_TRACKING)
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
    @Query('productId', new ParseUUIDPipe({ optional: true })) productId?: string,
    @Query('type') type?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
  ) {
    // Manually enum-validate `type` — @Query strings come through
    // unchecked even when the parameter type is the enum, since TS
    // types are erased at runtime. A bogus value like "ALL" used to
    // land in Prisma's where.type and just match nothing; the cleaner
    // surface is a 400 at the boundary.
    if (type !== undefined && !Object.values(StockMovementType).includes(type as StockMovementType)) {
      throw new BadRequestException(
        `type must be one of: ${Object.values(StockMovementType).join(', ')}`,
      );
    }

    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    if (start && Number.isNaN(start.getTime())) {
      throw new BadRequestException('startDate must be a valid ISO-8601 date string');
    }
    if (end && Number.isNaN(end.getTime())) {
      throw new BadRequestException('endDate must be a valid ISO-8601 date string');
    }

    let limitNum: number | undefined;
    if (limit !== undefined) {
      const parsed = parseInt(limit, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new BadRequestException('limit must be a positive integer');
      }
      limitNum = parsed;
    }

    return this.stockService.getMovements(
      req.tenantId,
      productId,
      type as StockMovementType | undefined,
      start,
      end,
      limitNum,
    );
  }

  @Get('alerts')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get low stock alerts (ADMIN, MANAGER)' })
  @ApiQuery({ name: 'threshold', required: false, description: 'Stock threshold (default: 10)' })
  @ApiResponse({ status: 200, description: 'List of low stock products', type: [StockAlertDto] })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  getLowStockAlerts(@Request() req, @Query('threshold') threshold?: string) {
    let thresholdNum = 10;
    if (threshold !== undefined) {
      const parsed = parseInt(threshold, 10);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) {
        throw new BadRequestException('threshold must be a non-negative integer ≤ 1,000,000');
      }
      thresholdNum = parsed;
    }
    return this.stockService.getLowStockAlerts(req.tenantId, thresholdNum);
  }
}
