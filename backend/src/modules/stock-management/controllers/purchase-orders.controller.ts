import { Controller, Get, Post, Patch, Body, Param, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { PurchaseOrdersService } from '../services/purchase-orders.service';
import { CreatePurchaseOrderDto } from '../dto/create-purchase-order.dto';
import { ReceivePurchaseOrderDto } from '../dto/receive-purchase-order.dto';

@ApiTags('stock-management/purchase-orders')
@ApiBearerAuth()
@Controller('stock-management/purchase-orders')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class PurchaseOrdersController {
  constructor(private readonly service: PurchaseOrdersService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get all purchase orders' })
  @ApiQuery({ name: 'status', required: false })
  findAll(@Request() req, @Query('status') status?: string) {
    return this.service.findAll(req.tenantId, status);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get a purchase order by ID' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.service.findOne(id, req.tenantId);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a purchase order' })
  create(@Body() dto: CreatePurchaseOrderDto, @Request() req) {
    return this.service.create(dto, req.tenantId);
  }

  @Post(':id/submit')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Submit a draft purchase order' })
  submit(@Param('id') id: string, @Request() req) {
    return this.service.submit(id, req.tenantId);
  }

  @Post(':id/receive')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Receive items against a purchase order' })
  receive(@Param('id') id: string, @Body() dto: ReceivePurchaseOrderDto, @Request() req) {
    return this.service.receive(id, dto, req.tenantId);
  }

  @Post(':id/cancel')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Cancel a purchase order' })
  cancel(@Param('id') id: string, @Request() req) {
    return this.service.cancel(id, req.tenantId);
  }
}
