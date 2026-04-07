import { Controller, Get, Post, Patch, Param, Query, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SalesInvoiceService } from '../services/sales-invoice.service';
import { AccountingSyncService } from '../services/accounting-sync.service';
import { CreateSalesInvoiceDto, InvoiceQueryDto } from '../dto/create-sales-invoice.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';

@ApiTags('sales-invoices')
@ApiBearerAuth()
@Controller('sales-invoices')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class SalesInvoiceController {
  constructor(
    private readonly service: SalesInvoiceService,
    private readonly syncService: AccountingSyncService,
  ) {}

  @Post('from-order/:orderId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  createFromOrder(
    @Param('orderId') orderId: string,
    @Request() req,
    @Body() dto: CreateSalesInvoiceDto,
  ) {
    return this.service.createFromOrder(orderId, req.tenantId, dto);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  findAll(@Request() req, @Query() query: InvoiceQueryDto) {
    return this.service.findAll(req.tenantId, query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  findOne(@Param('id') id: string, @Request() req) {
    return this.service.findOne(id, req.tenantId);
  }

  @Post(':id/sync')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async syncToProvider(@Param('id') id: string, @Request() req) {
    await this.syncService.syncInvoice(id, req.tenantId);
    return this.service.findOne(id, req.tenantId);
  }

  @Patch(':id/cancel')
  @Roles(UserRole.ADMIN)
  cancel(@Param('id') id: string, @Request() req) {
    return this.service.cancel(id, req.tenantId);
  }
}
