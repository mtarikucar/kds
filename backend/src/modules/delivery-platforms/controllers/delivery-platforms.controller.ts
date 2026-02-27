import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { DeliveryConfigService } from '../services/delivery-config.service';
import { DeliveryLogService } from '../services/delivery-log.service';
import { DeliveryMenuSyncService } from '../services/delivery-menu-sync.service';
import { CreatePlatformConfigDto } from '../dto/create-platform-config.dto';
import { UpdatePlatformConfigDto } from '../dto/update-platform-config.dto';

@ApiTags('delivery-platforms')
@ApiBearerAuth()
@Controller('delivery-platforms')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class DeliveryPlatformsController {
  constructor(
    private readonly configService: DeliveryConfigService,
    private readonly logService: DeliveryLogService,
    private readonly menuSyncService: DeliveryMenuSyncService,
  ) {}

  // ========================================
  // Platform Configuration CRUD
  // ========================================

  @Get('configs')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  findAllConfigs(@Request() req: any) {
    return this.configService.findAll(req.user.tenantId);
  }

  @Get('configs/:platform')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  findOneConfig(@Request() req: any, @Param('platform') platform: string) {
    return this.configService.findOne(req.user.tenantId, platform.toUpperCase());
  }

  @Post('configs')
  @Roles(UserRole.ADMIN)
  createConfig(@Request() req: any, @Body() dto: CreatePlatformConfigDto) {
    return this.configService.create(req.user.tenantId, dto);
  }

  @Patch('configs/:platform')
  @Roles(UserRole.ADMIN)
  updateConfig(
    @Request() req: any,
    @Param('platform') platform: string,
    @Body() dto: UpdatePlatformConfigDto,
  ) {
    return this.configService.update(
      req.user.tenantId,
      platform.toUpperCase(),
      dto,
    );
  }

  @Delete('configs/:platform')
  @Roles(UserRole.ADMIN)
  deleteConfig(@Request() req: any, @Param('platform') platform: string) {
    return this.configService.delete(req.user.tenantId, platform.toUpperCase());
  }

  // ========================================
  // Platform Actions
  // ========================================

  @Post('configs/:platform/test')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async testConnection(
    @Request() req: any,
    @Param('platform') platform: string,
  ) {
    const success = await this.configService.testConnection(
      req.user.tenantId,
      platform.toUpperCase(),
    );
    return { success };
  }

  @Post('configs/:platform/toggle-restaurant')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  toggleRestaurant(
    @Request() req: any,
    @Param('platform') platform: string,
    @Body('open') open: boolean,
  ) {
    return this.configService.toggleRestaurant(
      req.user.tenantId,
      platform.toUpperCase(),
      open,
    );
  }

  // ========================================
  // Logs
  // ========================================

  @Get('logs')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  getLogs(
    @Request() req: any,
    @Query('platform') platform?: string,
    @Query('success') success?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.logService.getLogs(req.user.tenantId, {
      platform: platform?.toUpperCase(),
      success: success !== undefined ? success === 'true' : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  // ========================================
  // Menu Mappings
  // ========================================

  @Get('menu-mappings')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  getMappings(
    @Request() req: any,
    @Query('platform') platform?: string,
  ) {
    return this.menuSyncService.getMappings(
      req.user.tenantId,
      platform?.toUpperCase(),
    );
  }

  @Post('menu-mappings')
  @Roles(UserRole.ADMIN)
  createMapping(
    @Request() req: any,
    @Body() body: { productId: string; platform: string; externalItemId: string; externalData?: any },
  ) {
    return this.menuSyncService.createMapping(
      req.user.tenantId,
      body.productId,
      body.platform.toUpperCase(),
      body.externalItemId,
      body.externalData,
    );
  }

  @Delete('menu-mappings/:id')
  @Roles(UserRole.ADMIN)
  deleteMapping(@Request() req: any, @Param('id') id: string) {
    return this.menuSyncService.deleteMapping(req.user.tenantId, id);
  }

  @Post('menu-sync/:platform')
  @Roles(UserRole.ADMIN)
  syncMenu(@Request() req: any, @Param('platform') platform: string) {
    return this.menuSyncService.syncMenuToPlatform(
      req.user.tenantId,
      platform.toUpperCase(),
    );
  }
}
