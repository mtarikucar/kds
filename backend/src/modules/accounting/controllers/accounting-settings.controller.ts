import { Controller, Get, Patch, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AccountingSettingsService } from '../services/accounting-settings.service';
import { UpdateAccountingSettingsDto } from '../dto/accounting-settings.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';

@ApiTags('accounting-settings')
@ApiBearerAuth()
@Controller('accounting-settings')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class AccountingSettingsController {
  constructor(private readonly service: AccountingSettingsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async findByTenant(@Request() req) {
    const settings = await this.service.findByTenant(req.tenantId);
    return this.service.sanitize(settings);
  }

  @Patch()
  @Roles(UserRole.ADMIN)
  async update(@Request() req, @Body() dto: UpdateAccountingSettingsDto) {
    const settings = await this.service.update(req.tenantId, dto);
    return this.service.sanitize(settings);
  }
}
