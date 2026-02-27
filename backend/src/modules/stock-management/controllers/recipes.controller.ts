import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { RecipesService } from '../services/recipes.service';
import { CreateRecipeDto } from '../dto/create-recipe.dto';
import { UpdateRecipeDto } from '../dto/update-recipe.dto';

@ApiTags('stock-management/recipes')
@ApiBearerAuth()
@Controller('stock-management/recipes')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class RecipesController {
  constructor(private readonly service: RecipesService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN)
  @ApiOperation({ summary: 'Get all recipes' })
  findAll(@Request() req) {
    return this.service.findAll(req.tenantId);
  }

  @Get('by-product/:productId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN)
  @ApiOperation({ summary: 'Get recipe by product ID' })
  findByProduct(@Param('productId') productId: string, @Request() req) {
    return this.service.findByProduct(productId, req.tenantId);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN)
  @ApiOperation({ summary: 'Get a recipe by ID' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.service.findOne(id, req.tenantId);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a recipe' })
  create(@Body() dto: CreateRecipeDto, @Request() req) {
    return this.service.create(dto, req.tenantId);
  }

  @Post(':id/check-stock')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN)
  @ApiOperation({ summary: 'Check if stock is sufficient for recipe' })
  checkStock(@Param('id') id: string, @Request() req, @Query('quantity') quantity?: string) {
    return this.service.checkStock(id, req.tenantId, quantity ? parseInt(quantity) : 1);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update a recipe' })
  update(@Param('id') id: string, @Body() dto: UpdateRecipeDto, @Request() req) {
    return this.service.update(id, dto, req.tenantId);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Delete a recipe' })
  remove(@Param('id') id: string, @Request() req) {
    return this.service.remove(id, req.tenantId);
  }
}
