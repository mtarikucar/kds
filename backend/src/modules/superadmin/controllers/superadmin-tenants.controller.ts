import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SuperAdminTenantsService } from '../services/superadmin-tenants.service';
import { TenantFilterDto, UpdateTenantStatusDto } from '../dto/tenant-filter.dto';
import { SuperAdminGuard } from '../guards/superadmin.guard';
import { SuperAdminRoute } from '../decorators/superadmin.decorator';
import { CurrentSuperAdmin } from '../decorators/current-superadmin.decorator';

@ApiTags('SuperAdmin Tenants')
@Controller('superadmin/tenants')
@UseGuards(SuperAdminGuard)
@SuperAdminRoute()
@ApiBearerAuth()
export class SuperAdminTenantsController {
  constructor(private readonly tenantsService: SuperAdminTenantsService) {}

  @Get()
  @ApiOperation({ summary: 'List all tenants with pagination and filters' })
  async findAll(@Query() filters: TenantFilterDto) {
    return this.tenantsService.findAll(filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get tenant details' })
  async findOne(@Param('id') id: string) {
    return this.tenantsService.findOne(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update tenant status (suspend/activate/delete)' })
  async updateStatus(
    @Param('id') id: string,
    @Body() updateDto: UpdateTenantStatusDto,
    @CurrentSuperAdmin('id') actorId: string,
    @CurrentSuperAdmin('email') actorEmail: string,
  ) {
    return this.tenantsService.updateStatus(id, updateDto, actorId, actorEmail);
  }

  @Get(':id/users')
  @ApiOperation({ summary: 'Get tenant users' })
  async getTenantUsers(
    @Param('id') id: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    return this.tenantsService.getTenantUsers(id, page, limit);
  }

  @Get(':id/orders')
  @ApiOperation({ summary: 'Get tenant orders' })
  async getTenantOrders(
    @Param('id') id: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    return this.tenantsService.getTenantOrders(id, page, limit);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'Get tenant statistics' })
  async getTenantStats(@Param('id') id: string) {
    return this.tenantsService.getTenantStats(id);
  }
}
