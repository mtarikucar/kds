import {
  BadRequestException,
  Injectable,
  Logger,
  ConflictException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { IngredientMovementType } from "../../../common/constants/stock-management.enum";
import { StockSettingsService } from "./stock-settings.service";

type Tx = Prisma.TransactionClient;

interface Deduction {
  stockItemId: string;
  quantity: Prisma.Decimal;
  stockItemName: string;
}

@Injectable()
export class StockDeductionService {
  private readonly logger = new Logger(StockDeductionService.name);

  constructor(
    private prisma: PrismaService,
    private stockSettings: StockSettingsService,
  ) {}

  /**
   * Deduct recipe ingredients for an order. Idempotent: relies on the
   * `order.stockDeducted` flag to guarantee we never double-deduct even
   * if the trigger fires multiple times. Concurrency-safe via a
   * conditional UPDATE (no TOCTOU between the "enough stock" check and
   * the write).
   */
  async deductForOrder(
    orderId: string,
    tenantId: string,
    currentStatus?: string,
    userId?: string,
  ) {
    const settings = await this.stockSettings.get(tenantId);
    if (!settings.enableAutoDeduction) return;
    if (
      settings.deductOnStatus &&
      (!currentStatus || currentStatus !== settings.deductOnStatus)
    ) {
      return;
    }

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: {
        orderItems: {
          include: {
            product: {
              include: {
                recipe: {
                  include: { ingredients: { include: { stockItem: true } } },
                },
              },
            },
          },
        },
      },
    });
    if (!order) return;
    // Idempotency: flip is done inside the transaction (updateMany with
    // stockDeducted=false as the where), so two concurrent deduction
    // triggers cannot both win the race.
    if (order.stockDeducted) {
      this.logger.debug(`Order ${order.orderNumber} already deducted`);
      return;
    }

    const deductions = this.buildDeductions(order);
    if (deductions.length === 0) return;

    return this.prisma.$transaction(
      async (tx) => {
        // Claim the idempotency slot atomically. Only one concurrent
        // caller can observe stockDeducted=false and flip it true; any
        // other loser exits cleanly.
        const claim = await tx.order.updateMany({
          where: { id: orderId, tenantId, stockDeducted: false },
          data: { stockDeducted: true },
        });
        if (claim.count === 0) return { deductions: [], lowStockAlerts: [] };

        const lowStockAlerts: string[] = [];
        for (const deduction of deductions) {
          await this.applyDeduction(
            tx,
            tenantId,
            order.branchId,
            order.orderNumber,
            orderId,
            deduction,
            settings.allowNegativeStock,
            userId,
            lowStockAlerts,
          );
        }

        this.logger.log(
          `Deducted ingredients for order ${order.orderNumber}: ${deductions.length} items`,
        );
        return { deductions, lowStockAlerts };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private buildDeductions(order: any): Deduction[] {
    const acc = new Map<string, Deduction>();
    for (const orderItem of order.orderItems) {
      const recipe = orderItem.product?.recipe;
      if (!recipe) continue;
      const yieldVal = recipe.yield || 1;
      for (const ingredient of recipe.ingredients) {
        const perServing = new Prisma.Decimal(ingredient.quantity).div(
          yieldVal,
        );
        const needed = perServing.mul(orderItem.quantity);
        const existing = acc.get(ingredient.stockItemId);
        if (existing) {
          existing.quantity = existing.quantity.add(needed);
        } else {
          acc.set(ingredient.stockItemId, {
            stockItemId: ingredient.stockItemId,
            quantity: needed,
            stockItemName: ingredient.stockItem.name,
          });
        }
      }
    }
    return [...acc.values()];
  }

  private async applyDeduction(
    tx: Tx,
    tenantId: string,
    branchId: string,
    orderNumber: string,
    orderId: string,
    deduction: Deduction,
    allowNegativeStock: boolean,
    userId: string | undefined,
    lowStockAlerts: string[],
  ) {
    const stockItem = await tx.stockItem.findFirst({
      where: { id: deduction.stockItemId, tenantId },
    });
    if (!stockItem) return;

    let remaining = deduction.quantity;
    // FIFO batch drawdown: consume the oldest (by expiryDate, then
    // receivedAt) batches first. If we run out of batches before the
    // full quantity is consumed, fall through to the bare stockItem
    // path below so legacy deployments without batches still work.
    //
    // v2.8.93 — explicit `nulls: 'last'` on expiryDate. Without it, the
    // sort order for NULL expiry depends on the underlying DB's ASC
    // default (PostgreSQL: NULLS LAST; MySQL/SQLite: NULLS FIRST). For
    // FIFO we always want batches WITH expiry (perishables) consumed
    // first by oldest expiry, and non-perishable / unknown-expiry
    // batches drawn down last. Pin the intent regardless of DB.
    const batches = await tx.stockBatch.findMany({
      where: {
        stockItemId: deduction.stockItemId,
        tenantId,
        quantity: { gt: 0 },
      },
      orderBy: [
        { expiryDate: { sort: "asc", nulls: "last" } },
        { receivedAt: "asc" },
      ],
    });
    // v2.8.93 — track batch-level cost during consumption so the
    // ingredient movement records the WEIGHTED-AVERAGE cost of the
    // batches actually drawn down, not the stockItem.costPerUnit
    // snapshot (which is the rolling average across all receipts and
    // can drift from the cost of the units actually shipped). When no
    // batches exist (legacy deployments) we fall back to the
    // stockItem-level cost below.
    let consumedFromBatches = new Prisma.Decimal(0);
    let weightedCostAccumulator = new Prisma.Decimal(0);
    for (const batch of batches) {
      if (remaining.lte(0)) break;
      const fromBatch = Prisma.Decimal.min(remaining, batch.quantity);
      const updated = await tx.stockBatch.updateMany({
        where: { id: batch.id, quantity: { gte: fromBatch } },
        data: { quantity: { decrement: fromBatch as any } },
      });
      if (updated.count === 0) continue; // lost a race with another deduction
      remaining = remaining.sub(fromBatch);
      consumedFromBatches = consumedFromBatches.add(fromBatch);
      if (batch.costPerUnit != null) {
        weightedCostAccumulator = weightedCostAccumulator.add(
          new Prisma.Decimal(batch.costPerUnit).mul(fromBatch),
        );
      }
    }

    // Prefer batch-weighted cost when any batches were consumed and at
    // least one carried a costPerUnit. Otherwise fall back to the
    // stockItem-level rolling cost.
    const finalCost =
      consumedFromBatches.gt(0) && weightedCostAccumulator.gt(0)
        ? weightedCostAccumulator.div(consumedFromBatches)
        : (stockItem.costPerUnit ?? null);

    // After batch drawdown `remaining` is what the bare stockItem row
    // needs to absorb. Do this as a conditional UPDATE: if
    // allowNegativeStock=false we require currentStock >= remaining,
    // otherwise we allow the decrement unconditionally. `updateMany`
    // returns `count: 0` when the guard fails (no race window).
    if (remaining.gt(0)) {
      const update = allowNegativeStock
        ? await tx.stockItem.updateMany({
            where: { id: deduction.stockItemId, tenantId },
            data: { currentStock: { decrement: remaining as any } },
          })
        : await tx.stockItem.updateMany({
            where: {
              id: deduction.stockItemId,
              tenantId,
              currentStock: { gte: remaining as any },
            },
            data: { currentStock: { decrement: remaining as any } },
          });
      if (update.count === 0) {
        throw new ConflictException(
          `Insufficient stock for ${deduction.stockItemName}`,
        );
      }
    }

    const totalDeducted = deduction.quantity;
    // v2.8.94 — surface the negative-stock state when allowNegativeStock=true
    // permits a decrement past zero. Pre-fix this branch logged nothing and
    // wrote no audit hint on the IngredientMovement, so an inventory
    // discrepancy (cycle-count miss, supplier short-ship, theft) sat silent
    // until someone visually scanned the stock list and noticed a negative
    // currentStock. Now we re-read post-decrement once and, if negative,
    // tag the movement notes and emit a warn log; the cost-recalc on the
    // next PO receive (purchase-orders.service) reads the same flag to
    // clamp its weighted-average math.
    const refreshed = await tx.stockItem.findFirst({
      where: { id: deduction.stockItemId, tenantId },
    });
    const wentNegative =
      !!refreshed && new Prisma.Decimal(refreshed.currentStock).lt(0);
    const movementNotes = wentNegative
      ? `Order ${orderNumber} ⚠ NEGATIVE_STOCK currentStock=${refreshed!.currentStock}`
      : `Order ${orderNumber}`;
    if (wentNegative) {
      this.logger.warn(
        `Negative stock after deduction tenant=${tenantId} stockItem=${deduction.stockItemId} (${deduction.stockItemName}) newStock=${refreshed!.currentStock} order=${orderNumber}`,
      );
    }
    await tx.ingredientMovement.create({
      data: {
        type: IngredientMovementType.ORDER_DEDUCTION,
        quantity: totalDeducted.neg() as any,
        costPerUnit: finalCost ?? undefined,
        notes: movementNotes,
        referenceType: "ORDER",
        referenceId: orderId,
        stockItemId: deduction.stockItemId,
        tenantId,
        branchId,
        createdById: userId,
      },
    });
    if (
      refreshed &&
      new Prisma.Decimal(refreshed.currentStock).lte(refreshed.minStock)
    ) {
      lowStockAlerts.push(deduction.stockItemName);
    }
  }

  /**
   * Reverse a prior deduction (cancellation / refund). Idempotent:
   * tracks which movements already have a matching ORDER_REVERSAL entry
   * so repeated calls don't inflate stock.
   */
  async reverseForOrder(orderId: string, tenantId: string, userId?: string) {
    const movements = await this.prisma.ingredientMovement.findMany({
      where: {
        tenantId,
        type: IngredientMovementType.ORDER_DEDUCTION,
        referenceType: "ORDER",
        referenceId: orderId,
      },
    });
    if (movements.length === 0) return;

    return this.prisma.$transaction(
      async (tx) => {
        // CRITICAL: read existingReversals INSIDE the txn, not above.
        // The Serializable isolation only protects writes-vs-writes —
        // it can't see an in-memory Set that was computed before the
        // txn started. Two concurrent reversal calls (cancel + refund
        // firing together — the documented case this txn-mode was
        // chosen for) both read an empty Set outside, both enter the
        // txn, and both re-create the same ORDER_REVERSAL movements →
        // stock gets double-credited. Reading inside the txn means
        // both calls see each other's writes (the second aborts with
        // 40001 and is retried by Prisma against the new snapshot,
        // which now includes the first call's reversals).
        const existingReversals = await tx.ingredientMovement.findMany({
          where: {
            tenantId,
            type: IngredientMovementType.ORDER_REVERSAL,
            referenceType: "ORDER_REVERSAL",
            referenceId: orderId,
          },
          select: { stockItemId: true },
        });
        const reversedItems = new Set(
          existingReversals.map((m) => m.stockItemId),
        );

        for (const movement of movements) {
          if (reversedItems.has(movement.stockItemId)) continue;

          const reverseQty = new Prisma.Decimal(movement.quantity).abs();

          const stockItem = await tx.stockItem.findFirst({
            where: { id: movement.stockItemId, tenantId },
          });
          if (!stockItem) continue;

          // Defence-in-depth: tenantId in the WHERE so a regression of
          // the pre-check can't expose cross-tenant stock writes.
          await tx.stockItem.updateMany({
            where: { id: movement.stockItemId, tenantId },
            data: { currentStock: { increment: reverseQty as any } },
          });

          await tx.ingredientMovement.create({
            data: {
              type: IngredientMovementType.ORDER_REVERSAL,
              quantity: reverseQty as any,
              costPerUnit: movement.costPerUnit ?? undefined,
              notes:
                `Reversal: order cancellation (${movement.notes ?? ""})`.trim(),
              referenceType: "ORDER_REVERSAL",
              referenceId: orderId,
              stockItemId: movement.stockItemId,
              tenantId,
              branchId: movement.branchId,
              createdById: userId,
            },
          });
        }

        // Flip the deduction flag back so a future re-deduction is
        // allowed (rare: re-opening a cancelled order).
        await tx.order.updateMany({
          where: { id: orderId, tenantId },
          data: { stockDeducted: false },
        });

        this.logger.log(
          `Reversed ingredient deductions for order ${orderId}: ${movements.length - reversedItems.size} items`,
        );
      },
      // Serializable isolation mirrors `deductForOrder` — concurrent
      // reversals (rare but possible if cancel + refund fire together)
      // must not both see the same "not yet reversed" snapshot and
      // double-credit the stock back.
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
