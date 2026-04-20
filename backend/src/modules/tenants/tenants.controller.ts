import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { TenantsService } from './tenants.service';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { UserRole } from '../../common/constants/roles.enum';

/**
 * Tenant-scoped settings for the logged-in restaurant. Platform-level
 * tenant CRUD is owned by the SuperAdmin module (see
 * `modules/superadmin/controllers/superadmin-tenants.controller.ts`).
 */
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
  @ApiResponse({ status: 403, description: 'Tenant suspended or insufficient permissions' })
  updateSettings(@Request() req, @Body() updateDto: UpdateTenantSettingsDto) {
    return this.tenantsService.updateSettings(req.tenantId, updateDto);
  }
}
