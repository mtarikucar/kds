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
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { UserRole } from '../../common/constants/roles.enum';

@ApiTags('tenants')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Public()
  @Get('public')
  @ApiOperation({ summary: 'Get all active tenants for registration (Public)' })
  @ApiResponse({ status: 200, description: 'List of active tenants' })
  findAllPublic() {
    return this.tenantsService.findAllPublic();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new tenant (ADMIN only)' })
  @ApiResponse({ status: 201, description: 'Tenant successfully created' })
  @ApiResponse({ status: 409, description: 'Subdomain already in use' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  create(@Body() createTenantDto: CreateTenantDto) {
    return this.tenantsService.create(createTenantDto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get current tenant (ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Current tenant details' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  findAll(@Request() req) {
    return this.tenantsService.findOne(req.tenantId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Get('settings')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get current tenant settings (ADMIN, MANAGER)' })
  @ApiResponse({ status: 200, description: 'Tenant settings retrieved successfully' })
  findSettings(@Request() req) {
    return this.tenantsService.findSettings(req.tenantId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Patch('settings')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update current tenant settings (ADMIN, MANAGER)' })
  @ApiResponse({ status: 200, description: 'Tenant settings updated successfully' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  updateSettings(@Request() req, @Body() updateDto: UpdateTenantSettingsDto) {
    return this.tenantsService.updateSettings(req.tenantId, updateDto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Get(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get a tenant by ID (ADMIN only, own tenant)' })
  @ApiResponse({ status: 200, description: 'Tenant details' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  findOne(@Param('id') id: string, @Request() req) {
    if (id !== req.tenantId) {
      throw new ForbiddenException('Cannot access other tenants');
    }
    return this.tenantsService.findOne(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update a tenant (ADMIN only, own tenant)' })
  @ApiResponse({ status: 200, description: 'Tenant successfully updated' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  update(@Param('id') id: string, @Body() updateTenantDto: UpdateTenantDto, @Request() req) {
    if (id !== req.tenantId) {
      throw new ForbiddenException('Cannot modify other tenants');
    }
    return this.tenantsService.update(id, updateTenantDto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete a tenant (ADMIN only, own tenant)' })
  @ApiResponse({ status: 200, description: 'Tenant successfully deleted' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  remove(@Param('id') id: string, @Request() req) {
    if (id !== req.tenantId) {
      throw new ForbiddenException('Cannot delete other tenants');
    }
    return this.tenantsService.remove(id);
  }
}
