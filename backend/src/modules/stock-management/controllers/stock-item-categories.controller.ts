import { Controller, Get, Post, Patch, Delete, Body, Param, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { StockItemCategoriesService } from '../services/stock-item-categories.service';
import { CreateStockItemCategoryDto } from '../dto/create-stock-item-category.dto';

@ApiTags('stock-management/categories')
@ApiBearerAuth()
@Controller('stock-management/categories')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class StockItemCategoriesController {
  constructor(private readonly service: StockItemCategoriesService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN)
  @ApiOperation({ summary: 'Get all stock item categories' })
  findAll(@Request() req) {
    return this.service.findAll(req.tenantId);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN)
  @ApiOperation({ summary: 'Get a stock item category by ID' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.service.findOne(id, req.tenantId);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a stock item category' })
  create(@Body() dto: CreateStockItemCategoryDto, @Request() req) {
    return this.service.create(dto, req.tenantId);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update a stock item category' })
  update(@Param('id') id: string, @Body() dto: Partial<CreateStockItemCategoryDto>, @Request() req) {
    return this.service.update(id, dto, req.tenantId);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Delete a stock item category' })
  remove(@Param('id') id: string, @Request() req) {
    return this.service.remove(id, req.tenantId);
  }
}
