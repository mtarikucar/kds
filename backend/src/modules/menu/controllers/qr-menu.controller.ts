import { Controller, Get, Param, Query, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';
import { PrismaService } from '../../../prisma/prisma.service';
import { PosSettingsService } from '../../pos-settings/pos-settings.service';
import { Public } from '../../auth/decorators/public.decorator';

@ApiTags('qr-menu')
@Controller('qr-menu')
export class QrMenuController {
  constructor(
    private prisma: PrismaService,
    private posSettingsService: PosSettingsService,
  ) {}

  @Public()
  @Get('by-subdomain/:subdomain')
  @ApiOperation({ summary: 'Get public menu by subdomain (no authentication required)' })
  @ApiParam({ name: 'subdomain', description: 'Restaurant subdomain' })
  @ApiQuery({ name: 'tableId', required: false, description: 'Optional table ID for table-specific QR codes' })
  @ApiResponse({ status: 200, description: 'Public menu with categories and products' })
  @ApiResponse({ status: 404, description: 'Restaurant not found' })
  async getPublicMenuBySubdomain(
    @Param('subdomain') subdomain: string,
    @Query('tableId') tableId?: string,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { subdomain },
    });

    if (!tenant) {
      throw new NotFoundException('Restaurant not found');
    }

    return this.getPublicMenu(tenant.id, tableId);
  }

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
      select: {
        id: true,
        name: true,
        wifiSsid: true,
        wifiPassword: true,
        socialInstagram: true,
        socialFacebook: true,
        socialTwitter: true,
        socialTiktok: true,
        socialYoutube: true,
        socialWhatsapp: true,
      },
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
            categoryId: true,
            productImages: {
              select: {
                order: true,
                image: {
                  select: {
                    id: true,
                    url: true,
                    filename: true,
                  },
                },
              },
              orderBy: { order: 'asc' },
            },
            modifierGroups: {
              where: {
                group: {
                  isActive: true,
                },
              },
              select: {
                displayOrder: true,
                group: {
                  select: {
                    id: true,
                    name: true,
                    displayName: true,
                    description: true,
                    selectionType: true,
                    minSelections: true,
                    maxSelections: true,
                    isRequired: true,
                    modifiers: {
                      where: {
                        isAvailable: true,
                      },
                      select: {
                        id: true,
                        name: true,
                        displayName: true,
                        description: true,
                        priceAdjustment: true,
                        displayOrder: true,
                      },
                      orderBy: { displayOrder: 'asc' },
                    },
                  },
                },
              },
              orderBy: { displayOrder: 'asc' },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { displayOrder: 'asc' },
    });

    // Transform categories to include images array instead of productImages
    // Also convert Prisma Decimal to number for JSON serialization
    const transformedCategories = categories.map(category => ({
      ...category,
      products: category.products.map(product => ({
        id: product.id,
        name: product.name,
        description: product.description,
        price: Number(product.price),
        image: product.image,
        categoryId: product.categoryId,
        images: product.productImages.map(pi => ({
          id: pi.image.id,
          url: pi.image.url,
          filename: pi.image.filename,
          order: pi.order,
        })),
        modifierGroups: product.modifierGroups.map(pmg => ({
          ...pmg.group,
          modifiers: pmg.group.modifiers.map(mod => ({
            ...mod,
            priceAdjustment: Number(mod.priceAdjustment),
          })),
        })),
      })),
    }));

    // Get POS settings to check if customer ordering is enabled
    const posSettings = await this.posSettingsService.findByTenant(tenantId);

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        wifi: tenant.wifiSsid ? {
          ssid: tenant.wifiSsid,
          password: tenant.wifiPassword,
        } : null,
        socialMedia: {
          instagram: tenant.socialInstagram,
          facebook: tenant.socialFacebook,
          twitter: tenant.socialTwitter,
          tiktok: tenant.socialTiktok,
          youtube: tenant.socialYoutube,
          whatsapp: tenant.socialWhatsapp,
        },
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
      enableCustomerOrdering: posSettings.enableCustomerOrdering,
      enableTablelessMode: posSettings.enableTablelessMode,
      categories: transformedCategories,
    };
  }
}
