import { Controller, Get, Post, Patch, Body, Param, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { StockCountsService } from '../services/stock-counts.service';
import { CreateStockCountDto } from '../dto/create-stock-count.dto';
import { UpdateStockCountItemDto } from '../dto/update-stock-count-item.dto';

@ApiTags('stock-management/stock-counts')
@ApiBearerAuth()
@Controller('stock-management/stock-counts')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class StockCountsController {
  constructor(private readonly service: StockCountsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get all stock counts' })
  @ApiQuery({ name: 'status', required: false })
  findAll(@Request() req, @Query('status') status?: string) {
    return this.service.findAll(req.tenantId, status);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get a stock count by ID' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.service.findOne(id, req.tenantId);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Start a new stock count session' })
  create(@Body() dto: CreateStockCountDto, @Request() req) {
    return this.service.create(dto, req.tenantId);
  }

  @Patch(':id/items/:itemId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update a counted quantity for a stock count item' })
  updateItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateStockCountItemDto,
    @Request() req,
  ) {
    return this.service.updateItem(id, itemId, dto, req.tenantId);
  }

  @Post(':id/finalize')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Finalize stock count and apply adjustments' })
  finalize(@Param('id') id: string, @Request() req) {
    return this.service.finalize(id, req.tenantId);
  }

  @Post(':id/cancel')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Cancel a stock count' })
  cancel(@Param('id') id: string, @Request() req) {
    return this.service.cancel(id, req.tenantId);
  }
}
