import { Controller, Get, Patch, Body, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { StockSettingsService } from '../services/stock-settings.service';
import { UpdateStockSettingsDto } from '../dto/update-stock-settings.dto';

@ApiTags('stock-management/settings')
@ApiBearerAuth()
@Controller('stock-management/settings')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class StockSettingsController {
  constructor(private readonly service: StockSettingsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get stock management settings' })
  get(@Request() req) {
    return this.service.get(req.tenantId);
  }

  @Patch()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update stock management settings' })
  update(@Body() dto: UpdateStockSettingsDto, @Request() req) {
    return this.service.update(dto, req.tenantId);
  }
}
