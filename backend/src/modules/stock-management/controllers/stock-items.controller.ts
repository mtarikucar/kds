import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { StockItemsService } from '../services/stock-items.service';
import { CreateStockItemDto } from '../dto/create-stock-item.dto';
import { UpdateStockItemDto } from '../dto/update-stock-item.dto';
import { StockItemQueryDto } from '../dto/stock-item-query.dto';

@ApiTags('stock-management/items')
@ApiBearerAuth()
@Controller('stock-management/items')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class StockItemsController {
  constructor(private readonly service: StockItemsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN)
  @ApiOperation({ summary: 'Get all stock items with optional filtering' })
  findAll(@Request() req, @Query() query: StockItemQueryDto) {
    return this.service.findAll(req.tenantId, query);
  }

  @Get('low-stock')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN)
  @ApiOperation({ summary: 'Get items at or below minimum stock level' })
  findLowStock(@Request() req) {
    return this.service.findLowStockItems(req.tenantId);
  }

  @Get('expiring-soon')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN)
  @ApiOperation({ summary: 'Get batches expiring soon' })
  @ApiQuery({ name: 'days', required: false, description: 'Days until expiry (default 3)' })
  findExpiringSoon(@Request() req, @Query('days') days?: string) {
    return this.service.findExpiringSoon(req.tenantId, days ? parseInt(days) : undefined);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN)
  @ApiOperation({ summary: 'Get a stock item by ID' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.service.findOne(id, req.tenantId);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a stock item' })
  create(@Body() dto: CreateStockItemDto, @Request() req) {
    return this.service.create(dto, req.tenantId);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update a stock item' })
  update(@Param('id') id: string, @Body() dto: UpdateStockItemDto, @Request() req) {
    return this.service.update(id, dto, req.tenantId);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Delete a stock item' })
  remove(@Param('id') id: string, @Request() req) {
    return this.service.remove(id, req.tenantId);
  }
}
