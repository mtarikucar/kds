import { Controller, Get, Param, Query, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
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
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
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
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':tenantId')
  @ApiOperation({ summary: 'Get public menu for QR code access (no authentication required)' })
  @ApiQuery({ name: 'tableId', required: false, description: 'Optional table ID for table-specific QR codes' })
  @ApiResponse({ status: 200, description: 'Public menu with categories and products' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  async getPublicMenu(
    @Param('tenantId') tenantId: string,
    @Query('tableId') tableId?: string,
  ) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, status: 'ACTIVE' },
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
      throw new NotFoundException('Restaurant not found');
    }

    // Read QR settings without side-effects. Creating a row on an anonymous
    // GET would let any caller trigger writes for a known tenantId and seed
    // default settings without admin intent. A null response uses defaults.
    const settings = await this.prisma.qrMenuSettings.findUnique({
      where: { tenantId },
    });

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
        primaryColor: settings?.primaryColor ?? '#3B82F6',
        secondaryColor: settings?.secondaryColor ?? '#F3F4F6',
        backgroundColor: settings?.backgroundColor ?? '#FFFFFF',
        fontFamily: settings?.fontFamily ?? 'Inter',
        logoUrl: settings?.logoUrl ?? null,
        showRestaurantInfo: settings?.showRestaurantInfo ?? true,
        showPrices: settings?.showPrices ?? true,
        showDescription: settings?.showDescription ?? true,
        showImages: settings?.showImages ?? true,
        layoutStyle: settings?.layoutStyle ?? 'GRID',
        itemsPerRow: settings?.itemsPerRow ?? 2,
      },
      enableCustomerOrdering: posSettings.enableCustomerOrdering,
      enableTablelessMode: posSettings.enableTablelessMode,
      categories: transformedCategories,
    };
  }
}
