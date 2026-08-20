import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";
import {
  PRINT3D_BASE_SKU,
  PRINT3D_ITEM_SKU,
  PRINT3D_MAX_ITEMS,
  PRINT3D_MIN_ITEMS,
  PRINT3D_PARTNER_LABEL,
  PRINT3D_PARTNER_URL_DEFAULT,
} from "./print3d.const";

/**
 * Yalnızca `http(s)://` ile başlayan bir değeri yayınla.
 *
 * Açık yönlendirme / `javascript:` yükü koruması. Bozuk bir env değeri
 * varsayılana DÜŞMEZ — açık bir yanlış yapılandırmayı sessizce düzeltmek,
 * operatörün hatayı hiç görmemesi demektir. Rozet metni yine boş kalmaz:
 * SPA bileşeni `null` gördüğünde düz metne düşer.
 */
export function sanitizePartnerUrl(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  return /^https?:\/\//i.test(raw) ? raw : null;
}

export interface Print3dOffer {
  /** İki SKU da published + DIRECT_SALE değilse false → SPA kartı gizler. */
  available: boolean;
  basePriceCents: number;
  perItemCents: number;
  currency: string;
  minItems: number;
  maxItems: number;
  partnerName: string;
  partnerUrl: string | null;
}

@Injectable()
export class Print3dService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Fiyatlar HER ZAMAN katalog satırlarından CANLI okunur, sabitlerden değil:
   * bir yeniden fiyatlama deploy istememeli. Sabitler yalnızca tohum/migration
   * kaynağı ve sürüklenme testi içindir.
   */
  async getOffer(): Promise<Print3dOffer> {
    const rows = await this.prisma.hardwareProduct.findMany({
      where: { sku: { in: [PRINT3D_BASE_SKU, PRINT3D_ITEM_SKU] } },
      select: {
        sku: true,
        priceCents: true,
        currency: true,
        status: true,
        saleMode: true,
      },
    });
    const base = rows.find((r) => r.sku === PRINT3D_BASE_SKU);
    const item = rows.find((r) => r.sku === PRINT3D_ITEM_SKU);
    const sellable = (r?: { status: string; saleMode: string | null }) =>
      !!r && r.status === "published" && r.saleMode === "DIRECT_SALE";

    return {
      available: sellable(base) && sellable(item),
      basePriceCents: base?.priceCents ?? 0,
      perItemCents: item?.priceCents ?? 0,
      currency: base?.currency ?? "TRY",
      minItems: PRINT3D_MIN_ITEMS,
      maxItems: PRINT3D_MAX_ITEMS,
      partnerName: PRINT3D_PARTNER_LABEL,
      partnerUrl: sanitizePartnerUrl(
        this.config.get<string>("PRINT3D_PARTNER_URL") ??
          PRINT3D_PARTNER_URL_DEFAULT,
      ),
    };
  }

  /**
   * Kalem + sipariş + kargo, kiracı ekranının tek çağrıda ihtiyacı olan her şey.
   * `hwOrder.shipments` burada: kargo durumu Shipment'ta yaşıyor, Print3dJob
   * yalnızca ÜRETİMİ izliyor.
   */
  private readonly jobInclude = {
    items: { orderBy: { position: "asc" as const } },
    hwOrder: {
      select: {
        id: true,
        status: true,
        totalCents: true,
        currency: true,
        createdAt: true,
        shippingAddress: true,
        shipments: {
          select: {
            id: true,
            carrier: true,
            trackingNo: true,
            status: true,
            shippedAt: true,
            deliveredAt: true,
          },
        },
      },
    },
  };

  async listMine(tenantId: string) {
    return this.prisma.print3dJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: this.jobInclude,
    });
  }

  async getMine(tenantId: string, id: string) {
    // BİLEŞİK WHERE. `findUnique({ where: { id } })` + sonradan tenant kontrolü
    // deseni bu repoda daha önce sızıntı üretti; çit sorgunun İÇİNDE olmalı.
    const row = await this.prisma.print3dJob.findFirst({
      where: { id, tenantId },
      include: this.jobInclude,
    });
    if (!row) throw new NotFoundException("3D baskı işi bulunamadı");
    return row;
  }
}
