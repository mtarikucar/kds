import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { PosSettingsService } from "../../pos-settings/pos-settings.service";

/**
 * Public-menu query, extracted VERBATIM from QrMenuController.getPublicMenu so
 * the @Public QR menu and the partner /display surface share one source of
 * truth. Menu content is tenant-level (no per-branch availability columns), so
 * the only filter besides tenant is the optional tableId for table-specific
 * QR codes. No behaviour change from the inline controller version.
 */
@Injectable()
export class MenuQueryService {
  constructor(
    private prisma: PrismaService,
    private posSettingsService: PosSettingsService,
  ) {}

  async getPublicMenu(tenantId: string, opts?: { tableId?: string }) {
    const tableId = opts?.tableId;

    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        wifiSsid: true,
        socialInstagram: true,
        socialFacebook: true,
        socialTwitter: true,
        socialTiktok: true,
        socialYoutube: true,
        socialWhatsapp: true,
      },
    });

    if (!tenant) {
      throw new NotFoundException("Restaurant not found");
    }

    // Read QR settings without side-effects. Creating a row on an anonymous
    // GET would let any caller trigger writes for a known tenantId and seed
    // default settings without admin intent. A null response uses defaults.
    // v3.0.1 — findFirst (compound-unique with branchId: null trips
    // Prisma client validation; see branch-scope.ts helper note).
    const settings = await this.prisma.qrMenuSettings.findFirst({
      where: { tenantId, branchId: null },
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
            model3dUrl: true,
            model3dUsdzUrl: true,
            model3dStatus: true,
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
              orderBy: { order: "asc" },
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
                      orderBy: { displayOrder: "asc" },
                    },
                  },
                },
              },
              orderBy: { displayOrder: "asc" },
            },
          },
          orderBy: { name: "asc" },
        },
      },
      orderBy: { displayOrder: "asc" },
    });

    // Transform categories to include images array instead of productImages
    // Also convert Prisma Decimal to number for JSON serialization
    const transformedCategories = categories.map((category) => ({
      ...category,
      products: category.products.map((product) => ({
        id: product.id,
        name: product.name,
        description: product.description,
        price: Number(product.price),
        image: product.image,
        categoryId: product.categoryId,
        // Only surface a 3D model to customers once it is READY (a PENDING or
        // FAILED model must not render an AR button in the QR menu).
        model3dUrl:
          product.model3dStatus === "READY" ? product.model3dUrl : null,
        model3dUsdzUrl:
          product.model3dStatus === "READY" ? product.model3dUsdzUrl : null,
        images: product.productImages.map((pi) => ({
          id: pi.image.id,
          url: pi.image.url,
          filename: pi.image.filename,
          order: pi.order,
        })),
        modifierGroups: product.modifierGroups.map((pmg) => ({
          ...pmg.group,
          modifiers: pmg.group.modifiers.map((mod) => ({
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
        wifi: tenant.wifiSsid
          ? {
              ssid: tenant.wifiSsid,
            }
          : null,
        socialMedia: {
          instagram: tenant.socialInstagram,
          facebook: tenant.socialFacebook,
          twitter: tenant.socialTwitter,
          tiktok: tenant.socialTiktok,
          youtube: tenant.socialYoutube,
          whatsapp: tenant.socialWhatsapp,
        },
      },
      table: table
        ? {
            id: table.id,
            number: table.number,
          }
        : null,
      settings: {
        primaryColor: settings?.primaryColor ?? "#3B82F6",
        secondaryColor: settings?.secondaryColor ?? "#F3F4F6",
        backgroundColor: settings?.backgroundColor ?? "#FFFFFF",
        fontFamily: settings?.fontFamily ?? "Inter",
        logoUrl: settings?.logoUrl ?? null,
        showRestaurantInfo: settings?.showRestaurantInfo ?? true,
        showPrices: settings?.showPrices ?? true,
        showDescription: settings?.showDescription ?? true,
        showImages: settings?.showImages ?? true,
        layoutStyle: settings?.layoutStyle ?? "GRID",
        itemsPerRow: settings?.itemsPerRow ?? 2,
      },
      enableCustomerOrdering: posSettings.enableCustomerOrdering,
      enableTablelessMode: posSettings.enableTablelessMode,
      enableCustomerSelfPay: !!posSettings.enableCustomerSelfPay,
      categories: transformedCategories,
    };
  }
}
