import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { PrismaService } from '../../../prisma/prisma.service';
import { Public } from '../../auth/decorators/public.decorator';

@ApiTags('qr-menu')
@Controller('qr-menu')
export class QrMenuController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Get(':tenantId')
  @ApiOperation({ summary: 'Get public menu for QR code access (no authentication required)' })
  @ApiQuery({ name: 'tableId', required: false, description: 'Optional table ID for table-specific QR codes' })
  @ApiResponse({ status: 200, description: 'Public menu with categories and products' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  async getPublicMenu(
    @Param('tenantId') tenantId: string,
    @Query('tableId') tableId?: string,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      return { error: 'Tenant not found' };
    }

    // Get QR settings (will create default if not exists)
    let settings = await this.prisma.qrMenuSettings.findUnique({
      where: { tenantId },
    });

    if (!settings) {
      settings = await this.prisma.qrMenuSettings.create({
        data: { tenantId },
      });
    }

    // Get table information if tableId provided
    let table = null;
    if (tableId) {
      table = await this.prisma.table.findFirst({
        where: { id: tableId, tenantId },
      });
    }

    const categories = await this.prisma.category.findMany({
      where: {
        tenantId,
        isActive: true,
      },
      include: {
        products: {
          where: {
            isAvailable: true,
          },
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            image: true,
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { displayOrder: 'asc' },
    });

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
      },
      table: table ? {
        id: table.id,
        number: table.number,
      } : null,
      settings: {
        primaryColor: settings.primaryColor,
        secondaryColor: settings.secondaryColor,
        backgroundColor: settings.backgroundColor,
        fontFamily: settings.fontFamily,
        logoUrl: settings.logoUrl,
        showRestaurantInfo: settings.showRestaurantInfo,
        showPrices: settings.showPrices,
        showDescription: settings.showDescription,
        showImages: settings.showImages,
        layoutStyle: settings.layoutStyle,
        itemsPerRow: settings.itemsPerRow,
      },
      categories,
    };
  }
}
