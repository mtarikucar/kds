import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { PosSettingsService } from "../../pos-settings/pos-settings.service";
import { MenuCacheService } from "./menu-cache.service";

/**
 * Public-menu query, extracted VERBATIM from QrMenuController.getPublicMenu so
 * the @Public QR menu and the partner /display surface share one source of
 * truth. Menu content is tenant-level (no per-branch availability columns), so
 * the only filter besides tenant is the optional tableId for table-specific
 * QR codes.
 *
 * Caching: the tenant-level payload (tenant info + QR settings + the deep
 * category→product→modifier tree + POS flags) is identical across every table
 * and re-read on every scan — the hottest anonymous query. It is cached in
 * Redis (MenuCacheService, short TTL, degrade-only). The per-request table
 * lookup is table-specific and stays uncached, merged on top of the cached base.
 */
@Injectable()
export class MenuQueryService {
  constructor(
    private prisma: PrismaService,
    private posSettingsService: PosSettingsService,
    private menuCache: MenuCacheService,
  ) {}

  async getPublicMenu(tenantId: string, opts?: { tableId?: string }) {
    const tableId = opts?.tableId;

    // Table info is table-specific (cannot be shared across a tenant's QR
    // codes), a single cheap indexed lookup, so it stays per-request and
    // uncached. Merged onto the cached tenant-level base below.
    let table = null;
    if (tableId) {
      table = await this.prisma.table.findFirst({
        where: { id: tableId, tenantId },
      });
    }
    const tablePayload = table
      ? { id: table.id, number: table.number }
      : null;

    // Serve the cached tenant-level menu when present; only the table changes
    // per request, so one cache entry serves every table + the no-table scan.
    const cached = await this.menuCache.getMenu<Record<string, unknown>>(
      tenantId,
    );
    if (cached) {
      return { ...cached, table: tablePayload };
    }

    const base = await this.buildTenantMenu(tenantId);
    // Best-effort populate — a cache write must never fail the request.
    await this.menuCache.setMenu(tenantId, base);
    return { ...base, table: tablePayload };
  }

  /**
   * Build the tenant-level menu payload (everything except the per-request
   * `table`). This is the cacheable unit; getPublicMenu adds `table` on top.
   */
  private async buildTenantMenu(tenantId: string) {
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
            ingredients: true,
            price: true,
            image: true,
            categoryId: true,
            model3dUrl: true,
            model3dUsdzUrl: true,
            model3dStatus: true,
            videoUrl: true,
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
        ingredients: product.ingredients,
        price: Number(product.price),
        image: product.image,
        categoryId: product.categoryId,
        // Only surface a 3D model to customers once it is READY (a PENDING or
        // FAILED model must not render an AR button in the QR menu).
        model3dUrl:
          product.model3dStatus === "READY" ? product.model3dUrl : null,
        model3dUsdzUrl:
          product.model3dStatus === "READY" ? product.model3dUsdzUrl : null,
        // The ingredients video (videoUrl is only set once the fal task is READY).
        videoUrl: product.videoUrl ?? null,
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
