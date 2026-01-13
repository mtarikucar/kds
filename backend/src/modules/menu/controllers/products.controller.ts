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
import { ProductsService } from '../services/products.service';
import { CreateProductDto } from '../dto/create-product.dto';
import { UpdateProductDto } from '../dto/update-product.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { PlanFeatureGuard } from '../../subscriptions/guards/plan-feature.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CheckLimit, LimitType } from '../../subscriptions/decorators/check-limit.decorator';
import { UserRole } from '../../../common/constants/roles.enum';

@ApiTags('menu-products')
@ApiBearerAuth()
@Controller('menu/products')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @CheckLimit(LimitType.PRODUCTS)
  @ApiOperation({ summary: 'Create a new product (ADMIN, MANAGER)' })
  @ApiResponse({ status: 201, description: 'Product successfully created' })
  @ApiResponse({ status: 400, description: 'Invalid category' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  create(@Body() createProductDto: CreateProductDto, @Request() req) {
    return this.productsService.create(createProductDto, req.tenantId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all products' })
  @ApiQuery({ name: 'categoryId', required: false, description: 'Filter by category ID' })
  @ApiResponse({ status: 200, description: 'List of all products' })
  findAll(@Request() req, @Query('categoryId') categoryId?: string) {
    return this.productsService.findAll(req.tenantId, categoryId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a product by ID' })
  @ApiResponse({ status: 200, description: 'Product details' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.productsService.findOne(id, req.tenantId);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update a product (ADMIN, MANAGER)' })
  @ApiResponse({ status: 200, description: 'Product successfully updated' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 400, description: 'Invalid category' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  update(
    @Param('id') id: string,
    @Body() updateProductDto: UpdateProductDto,
    @Request() req,
  ) {
    return this.productsService.update(id, updateProductDto, req.tenantId);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Delete a product (ADMIN, MANAGER)' })
  @ApiResponse({ status: 200, description: 'Product successfully deleted' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  remove(@Param('id') id: string, @Request() req) {
    return this.productsService.remove(id, req.tenantId);
  }

  @Patch(':id/stock')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update product stock (ADMIN, MANAGER)' })
  @ApiResponse({ status: 200, description: 'Stock successfully updated' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 400, description: 'Stock tracking not enabled or insufficient stock' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  updateStock(
    @Param('id') id: string,
    @Body('quantity') quantity: number,
    @Request() req,
  ) {
    return this.productsService.updateStock(id, quantity, req.tenantId);
  }

  // Image management endpoints
  @Get(':id/images')
  @ApiOperation({ summary: 'Get all images for a product' })
  @ApiResponse({ status: 200, description: 'List of product images' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  getProductImages(@Param('id') id: string, @Request() req) {
    return this.productsService.getProductImages(id, req.tenantId);
  }

  @Patch(':id/images/reorder')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Reorder product images (ADMIN, MANAGER)' })
  @ApiResponse({ status: 200, description: 'Images reordered successfully' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 400, description: 'Invalid image IDs' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  reorderImages(
    @Param('id') id: string,
    @Body('imageIds') imageIds: string[],
    @Request() req,
  ) {
    return this.productsService.reorderProductImages(id, imageIds, req.tenantId);
  }

  @Delete(':id/images/:imageId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Remove an image from product (ADMIN, MANAGER)' })
  @ApiResponse({ status: 200, description: 'Image removed successfully' })
  @ApiResponse({ status: 404, description: 'Product or image not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  removeImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Request() req,
  ) {
    return this.productsService.removeImageFromProduct(id, imageId, req.tenantId);
  }
}
