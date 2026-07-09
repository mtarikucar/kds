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
                // v3 branch-scope: a product carries one recipe PER BRANCH
                // (@@unique([productId, branchId])), so the relation is now
                // one-to-many. We can't reference order.branchId from inside
                // the query that fetches the order, so we pull the product's
                // recipe(s) and buildDeductions selects the row matching the
                // order's branch.
                recipes: {
                  include: {
                    ingredients: { include: { stockItem: true } },
                    // Nested BOM: one level of sub-recipe (prep) with its own
                    // stock ingredients, expanded at deduction time.
                    components: {
                      include: {
                        subRecipe: {
                          include: {
                            ingredients: { include: { stockItem: true } },
                            // Second BOM level (prep → sub-prep → dish).
                            components: {
                              include: {
                                subRecipe: {
                                  include: {
                                    ingredients: {
                                      include: { stockItem: true },
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
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
      // v3 branch-scope: products may carry one recipe per branch, so pick
      // the recipe belonging to THIS order's branch. Deducting from another
      // branch's recipe would draw down the wrong branch's stock.
      const recipe = (orderItem.product?.recipes ?? []).find(
        (r: any) => r.branchId === order.branchId,
      );
      if (!recipe) continue;
      // Produce orderItem.quantity servings of this recipe; expandRecipe walks
      // the direct ingredients and any nested sub-recipes.
      this.expandRecipe(recipe, new Prisma.Decimal(orderItem.quantity), acc, 0);
    }
    return [...acc.values()];
  }

  /**
   * Accumulate the base-unit stock draw for producing `servings` output units
   * of `recipe`. Direct ingredients scale by servings ÷ yield; a sub-recipe
   * component recurses, needing (component qty × factor × scale) of the
   * sub-recipe's output. Recipe-unit conversionFactor applies at every level;
   * null/≤0 factor = 1:1 (existing recipes unaffected). Depth-capped so a
   * cyclic sub-recipe definition can't recurse forever.
   */
  private expandRecipe(
    recipe: any,
    servings: Prisma.Decimal,
    acc: Map<string, Deduction>,
    depth: number,
  ) {
    if (!recipe || depth > 6) return;
    const yieldVal = new Prisma.Decimal(recipe.yield || 1);
    const scale = servings.div(yieldVal);
    const factorOf = (v: any) =>
      v != null && new Prisma.Decimal(v).gt(0)
        ? new Prisma.Decimal(v)
        : new Prisma.Decimal(1);

    for (const ingredient of recipe.ingredients ?? []) {
      const needed = new Prisma.Decimal(ingredient.quantity)
        .mul(factorOf(ingredient.conversionFactor))
        .mul(scale);
      const existing = acc.get(ingredient.stockItemId);
      if (existing) {
        existing.quantity = existing.quantity.add(needed);
      } else {
        acc.set(ingredient.stockItemId, {
          stockItemId: ingredient.stockItemId,
          quantity: needed,
          stockItemName: ingredient.stockItem?.name,
        });
      }
    }

    for (const comp of recipe.components ?? []) {
      const subServings = new Prisma.Decimal(comp.quantity)
        .mul(factorOf(comp.conversionFactor))
        .mul(scale);
      this.expandRecipe(comp.subRecipe, subServings, acc, depth + 1);
    }
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

    // FIFO batch drawdown — a COST sub-ledger only. The authoritative on-hand
    // total (stockItem.currentStock) is decremented by the FULL quantity below
    // regardless of batches; this loop exists purely to compute the
    // weighted-average cost of the units actually shipped (oldest batches
    // first). Deployments without batches simply skip it and fall back to
    // stockItem.costPerUnit.
    let remaining = deduction.quantity;
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

    // currentStock is the AUTHORITATIVE on-hand total and already INCLUDES
    // batch quantities: purchase-orders.receive() increments currentStock by
    // the received qty AND creates a StockBatch of the same qty; waste-logs
    // decrements currentStock by the FULL waste qty and draws batches down only
    // for costing. So the on-hand decrement must be the FULL deduction
    // quantity, NOT the post-batch leftover. Decrementing only the leftover (the
    // old behaviour) left currentStock inflated on every batch-covered sale,
    // which silently corrupted the ledger, defeated the oversell guard, and
    // suppressed low-stock alerts. Conditional UPDATE: when
    // allowNegativeStock=false we require currentStock >= quantity, so a
    // `count: 0` (guard failure) is the race-free "insufficient stock" signal.
    const qty = deduction.quantity;
    const update = allowNegativeStock
      ? await tx.stockItem.updateMany({
          where: { id: deduction.stockItemId, tenantId },
          data: { currentStock: { decrement: qty as any } },
        })
      : await tx.stockItem.updateMany({
          where: {
            id: deduction.stockItemId,
            tenantId,
            currentStock: { gte: qty as any },
          },
          data: { currentStock: { decrement: qty as any } },
        });
    if (update.count === 0) {
      throw new ConflictException(
        `Insufficient stock for ${deduction.stockItemName}`,
      );
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

          // Restore the FULL deducted quantity to the authoritative on-hand
          // total. This is symmetric with deductForOrder, which decrements
          // currentStock by the full quantity — so a deduct+reverse nets zero
          // and no phantom stock is minted.
          // Defence-in-depth: tenantId in the WHERE so a regression of the
          // pre-check can't expose cross-tenant stock writes.
          await tx.stockItem.updateMany({
            where: { id: movement.stockItemId, tenantId },
            data: { currentStock: { increment: reverseQty as any } },
          });

          // Restore the FIFO cost layer too, so Σ(batch.qty) stays in sync with
          // currentStock (a deduct+reverse nets to zero on the batch ledger as
          // well). The exact consumed batches aren't recorded on the movement,
          // so re-create a single layer at the movement's recorded cost.
          // CLAMP to the post-reversal headroom (currentStock − Σ batch.qty):
          // an allowNegativeStock oversell only drew batches down to 0, so
          // restoring the FULL reverseQty would mint phantom units and push
          // Σ(batch) ABOVE currentStock. Never let the restore exceed it.
          const newStock = new Prisma.Decimal(stockItem.currentStock).add(
            reverseQty,
          );
          const batchAgg = await tx.stockBatch.aggregate({
            where: {
              stockItemId: movement.stockItemId,
              tenantId,
              branchId: movement.branchId,
              quantity: { gt: 0 },
            },
            _sum: { quantity: true },
          });
          const headroom = newStock.sub(
            new Prisma.Decimal(batchAgg._sum.quantity ?? 0),
          );
          const restoreQty = Prisma.Decimal.min(
            reverseQty,
            Prisma.Decimal.max(headroom, new Prisma.Decimal(0)),
          );
          if (restoreQty.gt(0)) {
            await tx.stockBatch.create({
              data: {
                quantity: restoreQty as any,
                costPerUnit: new Prisma.Decimal(
                  movement.costPerUnit ?? stockItem.costPerUnit ?? 0,
                ) as any,
                stockItemId: movement.stockItemId,
                tenantId,
                branchId: movement.branchId,
              },
            });
          }

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
