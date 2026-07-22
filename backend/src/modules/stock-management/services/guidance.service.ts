import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import {
  matchCategory,
  type GuideCategory,
} from "./procurement-category.matcher";
import {
  PROCUREMENT_GUIDE,
  type VolumeTier,
} from "../data/procurement-guide.data";

// Real PurchaseOrder.status values (backend/src/common/constants/stock-management.enum.ts
// PurchaseOrderStatus) — a PO only counts as real procurement spend/history once it has
// left DRAFT/PENDING_APPROVAL and been actually submitted to the supplier.
const COUNTED_PO_STATUSES = ["SUBMITTED", "PARTIALLY_RECEIVED", "RECEIVED"];

type Source =
  | {
      type: "OWN_HISTORY";
      supplierId: string;
      supplierName: string;
      lastUnitPrice: number;
      lastPurchaseAt: string;
      avgUnitPrice90d: number;
      trendPct: number | null;
      receiptCount: number;
    }
  | {
      type: "CATALOG";
      supplierId: string;
      supplierName: string;
      unitPrice: number;
      isPreferred: boolean;
    }
  | {
      type: "CHANNEL";
      categoryKey: GuideCategory;
      channelKey: string | null;
      recommendationKey: string;
    };

export interface GuidanceResponse {
  volumeTier: VolumeTier;
  buyList: Array<{
    stockItemId: string;
    name: string;
    unit: string;
    currentStock: number;
    par: number;
    suggestedQty: number;
    purchaseUnit: string | null;
    purchaseQty: number | null;
    recommended: Source;
    alternatives: Source[];
  }>;
  channelGuide: Array<{
    categoryKey: GuideCategory;
    recommendationKey: string;
    detail: { channels: any[]; rules: string[] };
  }>;
}

const DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class GuidanceService {
  constructor(private readonly prisma: PrismaService) {}

  async getGuidance(
    tenantId: string,
    branchId: string,
  ): Promise<GuidanceResponse> {
    const volumeTier = await this.inferTier(tenantId, branchId);

    const items = await this.prisma.stockItem.findMany({
      where: { tenantId, branchId, isActive: true, minStock: { gt: 0 } },
      include: { category: { select: { name: true } } },
    });
    const belowPar = items.filter(
      (i: any) => Number(i.currentStock) <= Number(i.minStock),
    );

    const since180 = new Date(Date.now() - 180 * DAY);
    const history = belowPar.length
      ? await this.prisma.purchaseOrderItem.findMany({
          where: {
            stockItemId: { in: belowPar.map((i: any) => i.id) },
            purchaseOrder: {
              tenantId,
              branchId,
              status: { in: COUNTED_PO_STATUSES },
              createdAt: { gte: since180 },
            },
          },
          include: {
            purchaseOrder: {
              select: {
                supplierId: true,
                submittedAt: true,
                createdAt: true,
                supplier: { select: { name: true } },
              },
            },
          },
        })
      : [];

    const catalog = belowPar.length
      ? await this.prisma.supplierStockItem.findMany({
          where: { stockItemId: { in: belowPar.map((i: any) => i.id) } },
          include: { supplier: { select: { name: true } } },
        })
      : [];

    const buyList = belowPar.map((item: any) => {
      const par = Number(item.minStock);
      const cur = Number(item.currentStock);
      const suggestedQty =
        item.reorderQuantity != null
          ? Number(item.reorderQuantity)
          : Math.max(par * 2 - cur, par);
      const sources = this.sourcesForItem(item, history, catalog, volumeTier);
      return {
        stockItemId: item.id,
        name: item.name,
        unit: item.unit,
        currentStock: cur,
        par,
        suggestedQty,
        purchaseUnit: item.purchaseUnit ?? null,
        purchaseQty:
          item.purchaseUnit && item.purchaseConversion
            ? Math.ceil(suggestedQty / Number(item.purchaseConversion))
            : null,
        recommended: sources[0],
        alternatives: sources.slice(1, 3),
      };
    });

    const channelGuide = PROCUREMENT_GUIDE.categories.map((c) => ({
      categoryKey: c.categoryKey,
      recommendationKey: c.recommendationKeyByTier[volumeTier],
      detail: {
        channels: c.channels.map((ch) => ({
          channelKey: ch.channelKey,
          rankForTier: ch.rankForTier[volumeTier],
          advantageNote: ch.advantageNoteKey,
          minOrderNote: ch.minOrderNoteKey,
          paymentNote: ch.paymentNoteKey,
          eInvoiceNote: ch.eInvoiceNoteKey,
          sourceIds: ch.sourceIds,
        })),
        rules: c.ruleKeys,
      },
    }));

    return { volumeTier, buyList, channelGuide };
  }

  private async inferTier(
    tenantId: string,
    branchId: string,
  ): Promise<VolumeTier> {
    const branchCount = await this.prisma.branch.count({ where: { tenantId } });
    if (branchCount > 1) return "MULTI_BRANCH";
    const since90 = new Date(Date.now() - 90 * DAY);
    const recent = await this.prisma.purchaseOrderItem.findMany({
      where: {
        purchaseOrder: {
          tenantId,
          branchId,
          status: { in: COUNTED_PO_STATUSES },
          createdAt: { gte: since90 },
        },
      },
      select: { quantityOrdered: true, unitPrice: true },
    });
    const spend90 = recent.reduce(
      (s: number, l: any) =>
        s + Number(l.quantityOrdered) * Number(l.unitPrice),
      0,
    );
    const annualizedMonthly = spend90 / 3;
    return annualizedMonthly >= PROCUREMENT_GUIDE.midTierMonthlySpendTRY
      ? "MID_RESTAURANT"
      : "SMALL_CAFE";
  }

  // Base-unit price = unitPrice / (conversionFactor ?? 1) — mirrors the receive
  // path (purchase-orders.service.ts: baseUnitPrice = unitPrice.div(factor),
  // where null-or-<=0 factor falls back to 1). A stored conversionFactor <= 0
  // (including negative, e.g. corrupt data) must NOT be divided into the
  // price: unitPrice / -5 flips the sign and makes the line look like the
  // cheapest possible source, inverting supplier ranking.
  private baseUnitPrice(line: any): number {
    const raw =
      line.conversionFactor != null ? Number(line.conversionFactor) : NaN;
    const factor = Number.isFinite(raw) && raw > 0 ? raw : 1;
    return Number(line.unitPrice) / factor;
  }

  private sourcesForItem(
    item: any,
    history: any[],
    catalog: any[],
    volumeTier: VolumeTier,
  ): Source[] {
    const sources: Source[] = [];

    // OWN_HISTORY: per supplier, need ≥2 lines for the item across 180d.
    const lines = history.filter((h) => h.stockItemId === item.id);
    const bySupplier = new Map<string, any[]>();
    for (const l of lines) {
      const sid = l.purchaseOrder.supplierId;
      if (!bySupplier.has(sid)) bySupplier.set(sid, []);
      bySupplier.get(sid)!.push(l);
    }
    const histSources: Source[] = [];
    const since90 = Date.now() - 90 * DAY;
    for (const [sid, ls] of bySupplier) {
      if (ls.length < 2) continue;
      const sorted = [...ls].sort(
        (a, b) =>
          new Date(
            b.purchaseOrder.submittedAt ?? b.purchaseOrder.createdAt,
          ).getTime() -
          new Date(
            a.purchaseOrder.submittedAt ?? a.purchaseOrder.createdAt,
          ).getTime(),
      );
      const last = sorted[0];
      const lastUnitPrice = this.baseUnitPrice(last);
      const in90 = sorted.filter(
        (l) =>
          new Date(
            l.purchaseOrder.submittedAt ?? l.purchaseOrder.createdAt,
          ).getTime() >= since90,
      );
      const avg90 = in90.length
        ? in90.reduce((s, l) => s + this.baseUnitPrice(l), 0) / in90.length
        : lastUnitPrice;
      let trendPct: number | null = null;
      if (in90.length >= 2) {
        const oldest = in90[in90.length - 1];
        const oldP = this.baseUnitPrice(oldest);
        if (oldP > 0)
          trendPct = Math.round(((lastUnitPrice - oldP) / oldP) * 100);
      }
      histSources.push({
        type: "OWN_HISTORY",
        supplierId: sid,
        supplierName: last.purchaseOrder.supplier?.name ?? "—",
        lastUnitPrice,
        lastPurchaseAt: new Date(
          last.purchaseOrder.submittedAt ?? last.purchaseOrder.createdAt,
        ).toISOString(),
        avgUnitPrice90d: avg90,
        trendPct,
        receiptCount: ls.length,
      });
    }
    histSources.sort((a: any, b: any) => a.lastUnitPrice - b.lastUnitPrice); // cheapest first
    sources.push(...histSources);

    // CATALOG: SupplierStockItem unitPrice, cheapest first, preferred wins ties.
    const cat = catalog
      .filter((c) => c.stockItemId === item.id)
      .map(
        (c): Source => ({
          type: "CATALOG",
          supplierId: c.supplierId,
          supplierName: c.supplier?.name ?? "—",
          unitPrice: Number(c.unitPrice),
          isPreferred: !!c.isPreferred,
        }),
      )
      .sort(
        (a: any, b: any) =>
          a.unitPrice - b.unitPrice ||
          (b.isPreferred ? 1 : 0) - (a.isPreferred ? 1 : 0),
      );
    sources.push(...cat);

    // CHANNEL: always available as a last resort when a category matches.
    const categoryKey = matchCategory({
      categoryName: item.category?.name ?? null,
      itemName: item.name,
    });
    if (categoryKey) {
      const guide = PROCUREMENT_GUIDE.categories.find(
        (c) => c.categoryKey === categoryKey,
      );
      sources.push({
        type: "CHANNEL",
        categoryKey,
        channelKey: null,
        recommendationKey: guide
          ? guide.recommendationKeyByTier[volumeTier]
          : `guide.rec.${categoryKey}.${volumeTier}`,
      });
    }

    // Guarantee at least one source.
    if (sources.length === 0) {
      sources.push({
        type: "CHANNEL",
        categoryKey: "DRY_GOODS",
        channelKey: null,
        recommendationKey: "guide.rec.generic",
      });
    }
    return sources;
  }
}
