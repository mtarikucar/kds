import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { PlatformType, PlatformTypeLabels, PlatformTypeColors } from '../constants';
import { PlatformProviderFactory } from '../services/platform-provider.factory';
import { OrderIntegrationService } from '../services/order-integration.service';
import {
  ConfigurePlatformDto,
  TogglePlatformDto,
  PlatformOrderFilterDto,
  AcceptPlatformOrderDto,
  RejectPlatformOrderDto,
} from '../dto';
import { PrismaService } from '../../../prisma/prisma.service';
import { IntegrationType } from '../../../common/constants/integration-types.enum';

@Controller('admin/integrations')
@UseGuards(JwtAuthGuard, RolesGuard, TenantGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
export class OrderIntegrationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: PlatformProviderFactory,
    private readonly orderIntegrationService: OrderIntegrationService,
  ) {}

  /**
   * List all available platforms with their configuration status
   */
  @Get('platforms')
  async listPlatforms(@Request() req: any) {
    const tenantId = req.user.tenantId;

    const platforms = await Promise.all(
      Object.values(PlatformType).map(async (platformType) => {
        const settings = await this.prisma.integrationSettings.findFirst({
          where: {
            tenantId,
            integrationType: IntegrationType.DELIVERY_APP,
            provider: platformType,
          },
        });

        return {
          type: platformType,
          name: PlatformTypeLabels[platformType],
          color: PlatformTypeColors[platformType],
          isConfigured: settings?.isConfigured ?? false,
          isEnabled: settings?.isEnabled ?? false,
          lastSyncedAt: settings?.lastSyncedAt,
        };
      }),
    );

    return { platforms };
  }

  /**
   * Get specific platform configuration
   */
  @Get('platforms/:platformType')
  async getPlatform(
    @Request() req: any,
    @Param('platformType') platformType: PlatformType,
  ) {
    const tenantId = req.user.tenantId;

    const settings = await this.prisma.integrationSettings.findFirst({
      where: {
        tenantId,
        integrationType: IntegrationType.DELIVERY_APP,
        provider: platformType,
      },
    });

    // Get recent sync logs
    const recentLogs = await this.prisma.integrationSyncLog.findMany({
      where: { tenantId, platformType },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // Get stats
    const stats = await this.prisma.platformOrder.groupBy({
      by: ['internalStatus'],
      where: { tenantId, platformType },
      _count: true,
    });

    return {
      type: platformType,
      name: PlatformTypeLabels[platformType],
      color: PlatformTypeColors[platformType],
      isConfigured: settings?.isConfigured ?? false,
      isEnabled: settings?.isEnabled ?? false,
      config: settings?.config
        ? this.sanitizeConfig(settings.config as Record<string, unknown>)
        : null,
      lastSyncedAt: settings?.lastSyncedAt,
      recentLogs,
      stats,
    };
  }

  /**
   * Configure platform credentials
   */
  @Post('platforms/:platformType/configure')
  async configurePlatform(
    @Request() req: any,
    @Param('platformType') platformType: PlatformType,
    @Body() dto: ConfigurePlatformDto,
  ) {
    const tenantId = req.user.tenantId;

    await this.prisma.integrationSettings.upsert({
      where: {
        tenantId_integrationType_provider: {
          tenantId,
          integrationType: IntegrationType.DELIVERY_APP,
          provider: platformType,
        },
      },
      create: {
        tenantId,
        integrationType: IntegrationType.DELIVERY_APP,
        provider: platformType,
        name: PlatformTypeLabels[platformType],
        config: dto.config as object,
        isEnabled: true,
        isConfigured: true,
      },
      update: {
        config: dto.config as object,
        isConfigured: true,
      },
    });

    return { success: true, message: 'Platform configured successfully' };
  }

  /**
   * Test platform connection
   */
  @Post('platforms/:platformType/test')
  async testConnection(
    @Request() req: any,
    @Param('platformType') platformType: PlatformType,
  ) {
    const tenantId = req.user.tenantId;

    const provider = await this.providerFactory.getProviderForTenant(
      platformType,
      tenantId,
    );

    const result = await provider.testConnection();

    return result;
  }

  /**
   * Enable/disable platform
   */
  @Patch('platforms/:platformType/toggle')
  async togglePlatform(
    @Request() req: any,
    @Param('platformType') platformType: PlatformType,
    @Body() dto: TogglePlatformDto,
  ) {
    const tenantId = req.user.tenantId;

    await this.prisma.integrationSettings.updateMany({
      where: {
        tenantId,
        integrationType: IntegrationType.DELIVERY_APP,
        provider: platformType,
      },
      data: { isEnabled: dto.isEnabled },
    });

    return { success: true, isEnabled: dto.isEnabled };
  }

  /**
   * List platform orders
   */
  @Get('orders')
  async listPlatformOrders(
    @Request() req: any,
    @Query() filters: PlatformOrderFilterDto,
  ) {
    const tenantId = req.user.tenantId;

    return this.orderIntegrationService.getPlatformOrders(tenantId, {
      platformType: filters.platformType,
      status: filters.status,
      startDate: filters.startDate ? new Date(filters.startDate) : undefined,
      endDate: filters.endDate ? new Date(filters.endDate) : undefined,
      limit: filters.limit,
      offset: filters.offset,
    });
  }

  /**
   * Get platform order details
   */
  @Get('orders/:id')
  async getPlatformOrder(@Request() req: any, @Param('id') id: string) {
    return this.orderIntegrationService.getPlatformOrder(id, req.user.tenantId);
  }

  /**
   * Accept platform order
   */
  @Post('orders/:id/accept')
  async acceptOrder(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: AcceptPlatformOrderDto,
  ) {
    return this.orderIntegrationService.acceptPlatformOrder(
      id,
      req.user.tenantId,
      dto.estimatedPrepTime,
    );
  }

  /**
   * Reject platform order
   */
  @Post('orders/:id/reject')
  async rejectOrder(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: RejectPlatformOrderDto,
  ) {
    return this.orderIntegrationService.rejectPlatformOrder(
      id,
      req.user.tenantId,
      dto.reason,
    );
  }

  /**
   * Get integration statistics
   */
  @Get('stats')
  async getStats(@Request() req: any) {
    const tenantId = req.user.tenantId;

    const [ordersByPlatform, ordersByStatus, todayOrders] = await Promise.all([
      this.prisma.platformOrder.groupBy({
        by: ['platformType'],
        where: { tenantId },
        _count: true,
        _sum: { platformTotal: true },
      }),
      this.prisma.platformOrder.groupBy({
        by: ['internalStatus'],
        where: { tenantId },
        _count: true,
      }),
      this.prisma.platformOrder.count({
        where: {
          tenantId,
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      }),
    ]);

    return {
      ordersByPlatform,
      ordersByStatus,
      todayOrders,
    };
  }

  /**
   * Remove sensitive fields from config for API response
   */
  private sanitizeConfig(config: Record<string, unknown>): Record<string, unknown> {
    const sensitiveFields = ['apiSecret', 'clientSecret', 'webhookSecret', 'accessToken'];
    const sanitized = { ...config };

    for (const field of sensitiveFields) {
      if (field in sanitized) {
        sanitized[field] = '••••••••';
      }
    }

    return sanitized;
  }
}
