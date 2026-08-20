import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
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
import {
  UpdatePrint3dJobItemDto,
  UpdatePrint3dJobStatusDto,
} from "./dto/print3d-ops.dto";

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

  /**
   * İzinli geçişler. `produced` ve `cancelled` TERMİNAL: bir işi "geri almak"
   * üretim gerçeğini değiştirmez, yeni bir sipariş gerektirir.
   */
  private static readonly TRANSITIONS: Record<string, readonly string[]> = {
    queued: ["in_production", "cancelled"],
    in_production: ["produced", "cancelled"],
    produced: [],
    cancelled: [],
  };

  /**
   * Kuyruk satırlarına kiracı adını ekler.
   *
   * `include: { tenant: … }` KULLANILAMAZ: Print3dJob'ta `tenantId` düz bir
   * kolon, Tenant ilişkisi TANIMLI DEĞİL (InstallationRequest da aynı) —
   * Prisma böyle bir include'u reddeder. Adlar ayrı bir sorguyla eşlenir.
   */
  private async withTenantNames<T extends { tenantId: string }>(rows: T[]) {
    const ids = [...new Set(rows.map((r) => r.tenantId))];
    const tenants = await this.prisma.tenant.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const nameById = new Map(tenants.map((t) => [t.id, t.name]));
    return rows.map((r) => ({
      ...r,
      tenantName: nameById.get(r.tenantId) ?? null,
    }));
  }

  async listQueue(filters: { status?: string; partner?: string } = {}) {
    const rows = await this.prisma.print3dJob.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.partner ? { partner: filters.partner } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: 200,
      include: { items: { orderBy: { position: "asc" } } },
    });
    return this.withTenantNames(rows);
  }

  async getJob(id: string) {
    const row = await this.prisma.print3dJob.findUnique({
      where: { id },
      include: {
        items: { orderBy: { position: "asc" } },
        hwOrder: {
          select: {
            id: true,
            status: true,
            shippingAddress: true,
            shipments: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException("3D baskı işi bulunamadı");
    return (await this.withTenantNames([row]))[0];
  }

  async updateStatus(id: string, dto: UpdatePrint3dJobStatusDto) {
    const job = await this.prisma.print3dJob.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!job) throw new NotFoundException("3D baskı işi bulunamadı");
    const allowed = Print3dService.TRANSITIONS[job.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException({
        code: "PRINT3D_INVALID_TRANSITION",
        from: job.status,
        to: dto.status,
        message: `'${job.status}' durumundan '${dto.status}' durumuna geçilemez.`,
      });
    }
    return this.prisma.print3dJob.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.partnerRef !== undefined ? { partnerRef: dto.partnerRef } : {}),
        ...(dto.opsNote !== undefined ? { opsNote: dto.opsNote } : {}),
        ...(dto.status === "produced" ? { producedAt: new Date() } : {}),
        ...(dto.status === "cancelled" ? { cancelledAt: new Date() } : {}),
      },
    });
  }

  async updateItem(
    jobId: string,
    itemId: string,
    dto: UpdatePrint3dJobItemDto,
  ) {
    // Bileşik arama: bir itemId'nin BU işe ait olduğu doğrulanmadan
    // güncellenmesi, operatörün yanlış siparişin kalemini "basıldı"
    // işaretlemesine yol açardı.
    const item = await this.prisma.print3dJobItem.findFirst({
      where: { id: itemId, jobId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException("3D baskı kalemi bulunamadı");
    return this.prisma.print3dJobItem.update({
      where: { id: itemId },
      data: {
        status: dto.status,
        ...(dto.opsNote !== undefined ? { opsNote: dto.opsNote } : {}),
      },
    });
  }
}
