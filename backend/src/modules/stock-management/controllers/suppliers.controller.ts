import { Controller, Get, Post, Patch, Delete, Body, Param, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { SuppliersService } from '../services/suppliers.service';
import { CreateSupplierDto, UpdateSupplierDto, SupplierStockItemDto } from '../dto/create-supplier.dto';

@ApiTags('stock-management/suppliers')
@ApiBearerAuth()
@Controller('stock-management/suppliers')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class SuppliersController {
  constructor(private readonly service: SuppliersService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get all suppliers' })
  findAll(@Request() req) {
    return this.service.findAll(req.tenantId);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get a supplier by ID' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.service.findOne(id, req.tenantId);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a supplier' })
  create(@Body() dto: CreateSupplierDto, @Request() req) {
    return this.service.create(dto, req.tenantId);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update a supplier' })
  update(@Param('id') id: string, @Body() dto: UpdateSupplierDto, @Request() req) {
    return this.service.update(id, dto, req.tenantId);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Delete a supplier' })
  remove(@Param('id') id: string, @Request() req) {
    return this.service.remove(id, req.tenantId);
  }

  @Post(':id/items')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Add/update a stock item for this supplier' })
  addStockItem(@Param('id') id: string, @Body() dto: SupplierStockItemDto, @Request() req) {
    return this.service.addStockItem(id, dto, req.tenantId);
  }

  @Delete(':id/items/:stockItemId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Remove a stock item from this supplier' })
  removeStockItem(@Param('id') id: string, @Param('stockItemId') stockItemId: string, @Request() req) {
    return this.service.removeStockItem(id, stockItemId, req.tenantId);
  }
}
