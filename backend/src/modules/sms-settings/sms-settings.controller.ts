import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { SmsSettingsService } from './sms-settings.service';
import { UpdateSmsSettingsDto } from './dto/update-sms-settings.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles.enum';

@ApiTags('sms-settings')
@ApiBearerAuth()
@Controller('sms-settings')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class SmsSettingsController {
  constructor(private readonly smsSettingsService: SmsSettingsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get SMS notification settings for current tenant' })
  @ApiResponse({ status: 200, description: 'SMS settings retrieved successfully' })
  findByTenant(@Request() req) {
    return this.smsSettingsService.findByTenant(req.tenantId);
  }

  @Patch()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update SMS notification settings' })
  @ApiResponse({ status: 200, description: 'SMS settings updated successfully' })
  update(@Request() req, @Body() updateDto: UpdateSmsSettingsDto) {
    return this.smsSettingsService.update(req.tenantId, updateDto);
  }
}
