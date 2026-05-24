import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { SuperAdminGuard } from '../superadmin/guards/superadmin.guard';
import { CatalogService } from './catalog.service';
import { CreateHardwareProductDto } from './dto/create-hardware-product.dto';
import { UpdateHardwareProductDto } from './dto/update-hardware-product.dto';
import { ReceiveStockDto } from './dto/receive-stock.dto';

@ApiTags('Hardware Catalog')
@Controller('v1/catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get('products')
  @ApiOperation({ summary: 'Public hardware store — published products only' })
  listPublic(@Query('category') category?: string) {
    return this.catalog.listPublic({ category });
  }

  @Public()
  @Get('products/sku/:sku')
  @ApiOperation({ summary: 'Public product lookup by SKU' })
  bySku(@Param('sku') sku: string) {
    return this.catalog.findBySkuOrThrow(sku);
  }
}

@ApiTags('SuperAdmin · Hardware Catalog')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('v1/superadmin/catalog')
export class SuperadminCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('products')
  list(@Query('status') status?: string, @Query('category') category?: string) {
    return this.catalog.listAdmin({ status, category });
  }

  @Post('products')
  create(@Body() body: CreateHardwareProductDto) {
    return this.catalog.create(body);
  }

  @Patch('products/:id')
  update(@Param('id') id: string, @Body() body: UpdateHardwareProductDto) {
    return this.catalog.update(id, body);
  }

  @Delete('products/:id')
  archive(@Param('id') id: string) {
    return this.catalog.archive(id);
  }

  @Post('products/:id/stock')
  @ApiOperation({ summary: 'Receive stock — optionally with serials' })
  receive(@Param('id') id: string, @Body() body: ReceiveStockDto) {
    return this.catalog.receiveStock(id, body.qty, body.serials);
  }
}
