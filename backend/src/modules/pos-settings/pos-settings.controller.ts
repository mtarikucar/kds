import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { PosSettingsService } from './pos-settings.service';
import { UpdatePosSettingsDto } from './dto/update-pos-settings.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles.enum';

@ApiTags('pos-settings')
@ApiBearerAuth()
@Controller('pos-settings')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class PosSettingsController {
  constructor(private readonly posSettingsService: PosSettingsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: 'Get POS settings for current tenant (ADMIN, MANAGER, WAITER)' })
  @ApiResponse({ status: 200, description: 'POS settings retrieved successfully' })
  findByTenant(@Request() req) {
    return this.posSettingsService.findByTenant(req.tenantId);
  }

  @Patch()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update POS settings (ADMIN, MANAGER)' })
  @ApiResponse({ status: 200, description: 'POS settings updated successfully' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  update(@Request() req, @Body() updateDto: UpdatePosSettingsDto) {
    return this.posSettingsService.update(req.tenantId, updateDto);
  }
}
