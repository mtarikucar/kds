import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { BranchScope, branchScope } from "../../../common/scoping/branch-scope";
import {
  baseToPurchasePacks,
  purchaseToBase,
} from "../../../common/utils/uom.util";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export interface SuggestionLine {
  stockItemId: string;
  name: string;
  unit: string;
  currentStock: number;
  par: number;
  suggestedQty: number;
  unitPrice: number;
  estimatedCost: number;
  // Set when the item is bought in packs: order this many `purchaseUnit`s.
  purchaseUnit: string | null;
  purchaseQty: number | null;
  supplier: { id: string; name: string; supplierSku: string | null } | null;
}

/**
 * Reorder suggestions — turns par levels (StockItem.minStock) into a proposed
 * draft purchase order per preferred supplier. An item at/below its par becomes
 * a suggested line: the order quantity is the explicit reorderQuantity, else a
 * derived default that brings stock back toward twice the par level. The line
 * is priced from the preferred supplier's contract price (falling back to any
 * supplier, then the item's own costPerUnit) and grouped into one draft order
 * per supplier so the operator can review + submit. Items with no supplier are
 * surfaced under `unassigned`.
 */
@Injectable()
export class ReorderSuggestionService {
  constructor(private prisma: PrismaService) {}

  async getSuggestions(scope: BranchScope) {
    // Prisma can't compare currentStock <= minStock (column-to-column), so
    // fetch active items with a par set (bounded by catalog size — hundreds)
    // and filter below-par in memory.
    const items = await this.prisma.stockItem.findMany({
      where: {
        ...branchScope(scope),
        isActive: true,
        minStock: { gt: 0 },
      },
      select: {
        id: true,
        name: true,
        unit: true,
        currentStock: true,
        minStock: true,
        costPerUnit: true,
        reorderQuantity: true,
        purchaseUnit: true,
        purchaseConversion: true,
        supplierStockItems: {
          select: {
            isPreferred: true,
            unitPrice: true,
            supplierSku: true,
            supplier: { select: { id: true, name: true } },
          },
        },
      },
    });

    const belowPar = items.filter((i) =>
      new Prisma.Decimal(i.currentStock).lte(i.minStock),
    );

    const lines: SuggestionLine[] = belowPar.map((i) => {
      const par = Number(i.minStock);
      const cur = Number(i.currentStock);
      const baseNeed =
        i.reorderQuantity != null
          ? Number(i.reorderQuantity)
          : Math.max(par * 2 - cur, par);
      // If the item is bought in packs, round the base need UP to whole packs
      // and surface the pack count so the operator orders in purchase units.
      const factor =
        i.purchaseConversion != null ? Number(i.purchaseConversion) : null;
      let suggestedQty = baseNeed;
      let purchaseUnit: string | null = null;
      let purchaseQty: number | null = null;
      if (factor && factor > 1 && i.purchaseUnit) {
        purchaseQty = baseToPurchasePacks(baseNeed, factor);
        suggestedQty = purchaseToBase(purchaseQty, factor);
        purchaseUnit = i.purchaseUnit;
      }
      // Preferred supplier wins; else the first supplier; else no supplier.
      const preferred =
        i.supplierStockItems.find((s) => s.isPreferred) ??
        i.supplierStockItems[0] ??
        null;
      const unitPrice = preferred
        ? Number(preferred.unitPrice)
        : Number(i.costPerUnit);
      return {
        stockItemId: i.id,
        name: i.name,
        unit: i.unit,
        currentStock: r3(cur),
        par: r3(par),
        suggestedQty: r3(suggestedQty),
        unitPrice: r4(unitPrice),
        estimatedCost: r2(suggestedQty * unitPrice),
        purchaseUnit,
        purchaseQty,
        supplier: preferred?.supplier
          ? {
              id: preferred.supplier.id,
              name: preferred.supplier.name,
              supplierSku: preferred.supplierSku ?? null,
            }
          : null,
      };
    });

    const bySupplier = new Map<
      string,
      {
        supplierId: string;
        supplierName: string;
        items: SuggestionLine[];
        estimatedTotal: number;
      }
    >();
    const unassigned: SuggestionLine[] = [];
    for (const l of lines) {
      if (!l.supplier) {
        unassigned.push(l);
        continue;
      }
      const g = bySupplier.get(l.supplier.id) ?? {
        supplierId: l.supplier.id,
        supplierName: l.supplier.name,
        items: [],
        estimatedTotal: 0,
      };
      g.items.push(l);
      g.estimatedTotal += l.estimatedCost;
      bySupplier.set(l.supplier.id, g);
    }

    return {
      draftOrders: [...bySupplier.values()].map((g) => ({
        ...g,
        estimatedTotal: r2(g.estimatedTotal),
      })),
      unassigned,
      totalItemsBelowPar: lines.length,
    };
  }
}
