import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { CreatePurchaseOrderDto } from "../dto/create-purchase-order.dto";
import { ReceivePurchaseOrderDto } from "../dto/receive-purchase-order.dto";
import {
  PurchaseOrderStatus,
  IngredientMovementType,
} from "../../../common/constants/stock-management.enum";
import { BranchScope, branchScope } from "../../../common/scoping/branch-scope";

type Tx = Prisma.TransactionClient;

@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger(PurchaseOrdersService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Mint a monotonic, collision-free PO number via a per-tenant
   * counter on StockSettings. The counter is incremented inside the
   * creation transaction so two concurrent creates cannot pick the
   * same number.
   */
  private async allocatePoNumber(tx: Tx, tenantId: string): Promise<string> {
    // v3.0.1 — findFirst + update/create instead of upsert. The compound
    // unique (tenantId, branchId) with branchId nullable trips Prisma's
    // client-side validation on upsert; see branch-scope helper note.
    // Race-safety: callers always invoke this inside an outer txn, and
    // the P2002 catch on create swallows the loser of a concurrent
    // first-allocation race and re-increments via the now-existing row.
    const existing = await tx.stockSettings.findFirst({
      where: { tenantId, branchId: null },
    });
    let settings: { poSequence: number; poNumberPrefix: string };
    if (existing) {
      const updated = await tx.stockSettings.updateMany({
        where: { tenantId, branchId: null },
        data: { poSequence: { increment: 1 } },
      });
      if (updated.count === 0) {
        // Defensive — the row vanished mid-txn. Treat as fresh allocate.
        settings = await tx.stockSettings.create({
          data: { tenantId, poSequence: 1 },
        });
      } else {
        settings = await tx.stockSettings.findFirstOrThrow({
          where: { tenantId, branchId: null },
        });
      }
    } else {
      try {
        settings = await tx.stockSettings.create({
          data: { tenantId, poSequence: 1 },
        });
      } catch (e: any) {
        if (e?.code === "P2002") {
          // Concurrent allocator beat us to the create. Re-increment.
          await tx.stockSettings.updateMany({
            where: { tenantId, branchId: null },
            data: { poSequence: { increment: 1 } },
          });
          settings = await tx.stockSettings.findFirstOrThrow({
            where: { tenantId, branchId: null },
          });
        } else {
          throw e;
        }
      }
    }
    const seq = String(settings.poSequence).padStart(5, "0");
    return `${settings.poNumberPrefix}-${seq}`;
  }

  async findAll(scope: BranchScope, status?: string) {
    const where: Prisma.PurchaseOrderWhereInput = { ...branchScope(scope) };
    if (status) where.status = status;

    return this.prisma.purchaseOrder.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true } },
        items: {
          include: {
            stockItem: { select: { id: true, name: true, unit: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(id: string, scope: BranchScope) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, ...branchScope(scope) },
      include: {
        supplier: true,
        items: {
          include: {
            stockItem: {
              select: { id: true, name: true, unit: true, branchId: true },
            },
          },
        },
      },
    });
    if (!po) throw new NotFoundException("Purchase order not found");
    return po;
  }

  async create(
    dto: CreatePurchaseOrderDto,
    tenantId: string,
    branchId: string,
    userId?: string,
  ) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, tenantId },
    });
    if (!supplier) throw new BadRequestException("Supplier not found");

    const stockItemIds = dto.items.map((i) => i.stockItemId);
    const stockItems = await this.prisma.stockItem.findMany({
      where: { id: { in: stockItemIds }, tenantId },
    });
    if (stockItems.length !== stockItemIds.length) {
      throw new BadRequestException("One or more stock items not found");
    }
    // v3.0.0 strict branch-scope: a PO is a single-branch document. If
    // the caller's scope doesn't match every referenced stock item's
    // branchId, refuse — the alternative is silently writing a PO into
    // one branch that decrements another branch's stock on receive.
    if (stockItems.some((si) => si.branchId !== branchId)) {
      throw new BadRequestException(
        "All stock items must belong to the current branch",
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const orderNumber = await this.allocatePoNumber(tx, tenantId);
      return tx.purchaseOrder.create({
        data: {
          orderNumber,
          supplierId: dto.supplierId,
          notes: dto.notes,
          expectedDate: dto.expectedDate
            ? new Date(dto.expectedDate)
            : undefined,
          tenantId,
          branchId,
          createdById: userId,
          items: {
            create: dto.items.map((item) => ({
              stockItemId: item.stockItemId,
              quantityOrdered: item.quantityOrdered,
              unitPrice: item.unitPrice,
            })),
          },
        },
        include: {
          supplier: { select: { id: true, name: true } },
          items: {
            include: {
              stockItem: { select: { id: true, name: true, unit: true } },
            },
          },
        },
      });
    });
  }

  async submit(id: string, scope: BranchScope) {
    const po = await this.findOne(id, scope);
    if (po.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException(
        "Only draft purchase orders can be submitted",
      );
    }

    // Atomic claim with branch + status predicate — if a parallel call
    // already submitted this PO (or it slipped to another state), the
    // updateMany returns 0 and we abort instead of clobbering a more
    // advanced status. Also serves as the IDOR guard ((tenantId,
    // branchId) filter).
    const result = await this.prisma.purchaseOrder.updateMany({
      where: { id, ...branchScope(scope), status: PurchaseOrderStatus.DRAFT },
      data: { status: PurchaseOrderStatus.SUBMITTED, submittedAt: new Date() },
    });
    if (result.count === 0) {
      throw new BadRequestException("Purchase order is no longer in DRAFT");
    }
    return this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, name: true } },
        items: {
          include: {
            stockItem: {
              select: { id: true, name: true, unit: true, branchId: true },
            },
          },
        },
      },
    });
  }

  async receive(
    id: string,
    dto: ReceivePurchaseOrderDto,
    scope: BranchScope,
    userId?: string,
  ) {
    // Cheap pre-flight rejection so the obvious "wrong status" case
    // doesn't burn a Serializable txn. The in-txn re-read below is
    // what actually guards the race. findOne is branch-fenced, so a
    // cross-branch PO id is rejected before any stock is mutated.
    const po = await this.findOne(id, scope);
    if (
      po.status !== PurchaseOrderStatus.SUBMITTED &&
      po.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED
    ) {
      throw new BadRequestException(
        "Only submitted or partially received purchase orders can be received",
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        for (const lineItem of dto.items) {
          // Re-read poItem INSIDE the txn. The earlier code computed
          // `alreadyReceived` from the outside-txn `findOne` snapshot, so
          // two concurrent partial receives both saw quantityReceived=N
          // and both wrote N+their_qty → the second update silently
          // clobbered the first (lost update). Postgres' default READ
          // COMMITTED won't catch this; only the in-txn re-read does,
          // and the Serializable isolation below promotes any remaining
          // write-vs-write race into a 40001 that Prisma retries.
          const poItem = await tx.purchaseOrderItem.findFirst({
            where: {
              id: lineItem.purchaseOrderItemId,
              purchaseOrderId: id,
            },
            include: { stockItem: { select: { name: true, branchId: true } } },
          });
          if (!poItem) {
            throw new BadRequestException(
              `Purchase order item ${lineItem.purchaseOrderItemId} not found`,
            );
          }

          const receivedQty = new Prisma.Decimal(lineItem.quantityReceived);
          const alreadyReceived = new Prisma.Decimal(poItem.quantityReceived);
          const ordered = new Prisma.Decimal(poItem.quantityOrdered);
          const newReceived = alreadyReceived.add(receivedQty);
          if (newReceived.gt(ordered)) {
            throw new BadRequestException(
              `Cannot receive more than ordered for ${poItem.stockItem.name}. Ordered: ${ordered}, Already received: ${alreadyReceived}, Attempting: ${receivedQty}`,
            );
          }

          await tx.purchaseOrderItem.update({
            where: { id: poItem.id },
            data: { quantityReceived: newReceived as any },
          });

          // Weighted-average costing: new unit cost is
          // (existingStock*existingCost + receivedQty*unitPrice) /
          // (existingStock + receivedQty). Preserves the book value of
          // older lots instead of the prior behaviour that blindly
          // overwrote costPerUnit with the latest unit price.
          const stockItem = await tx.stockItem.findUnique({
            where: { id: poItem.stockItemId },
          });
          if (!stockItem) {
            throw new BadRequestException("Stock item disappeared");
          }
          const existingStock = new Prisma.Decimal(stockItem.currentStock);
          const existingCost = new Prisma.Decimal(stockItem.costPerUnit ?? 0);
          const unitPrice = new Prisma.Decimal(poItem.unitPrice);
          const newStock = existingStock.add(receivedQty);
          // v2.8.94 — clamp existingStock to zero in the weighted-average
          // numerator. Pre-fix a negative currentStock (left behind by an
          // earlier allowNegativeStock=true deduction past zero — see
          // stock-deduction.service.applyDeduction) would invert the
          // weighting math: `(-5 * 10 + 100 * 20) / 95 = ~20.5` skews the
          // cost basis nonsensically. Negative stock is an inventory
          // discrepancy, not an economic position; the new PO receive
          // resets the cost basis as if existingStock were zero.
          const clampedExisting = Prisma.Decimal.max(
            existingStock,
            new Prisma.Decimal(0),
          );
          const denominator = clampedExisting.add(receivedQty);
          const weightedCost =
            newStock.isZero() || denominator.isZero()
              ? unitPrice
              : clampedExisting
                  .mul(existingCost)
                  .add(receivedQty.mul(unitPrice))
                  .div(denominator);

          await tx.stockItem.update({
            where: { id: poItem.stockItemId },
            data: {
              currentStock: { increment: receivedQty as any },
              costPerUnit: weightedCost.toDecimalPlaces(
                4,
                Prisma.Decimal.ROUND_HALF_UP,
              ) as any,
            },
          });

          // Always create a batch so FIFO drawdown has something to
          // consume — the prior behaviour only created a batch when
          // batchNumber / expiryDate was supplied, so typical receives
          // left deduction on the bare stockItem path.
          await tx.stockBatch.create({
            data: {
              batchNumber: lineItem.batchNumber,
              quantity: receivedQty as any,
              costPerUnit: unitPrice as any,
              expiryDate: lineItem.expiryDate
                ? new Date(lineItem.expiryDate)
                : undefined,
              stockItemId: poItem.stockItemId,
              purchaseOrderItemId: poItem.id,
              tenantId: scope.tenantId,
              branchId: scope.branchId,
            },
          });

          await tx.ingredientMovement.create({
            data: {
              type: IngredientMovementType.PO_RECEIVE,
              quantity: receivedQty as any,
              costPerUnit: unitPrice as any,
              notes: `PO ${po.orderNumber}${dto.notes ? ` - ${dto.notes}` : ""}`,
              referenceType: "PURCHASE_ORDER",
              referenceId: po.id,
              stockItemId: poItem.stockItemId,
              branchId: scope.branchId,
              tenantId: scope.tenantId,
              createdById: userId,
            },
          });
        }

        const updatedItems = await tx.purchaseOrderItem.findMany({
          where: { purchaseOrderId: id },
        });
        const allReceived = updatedItems.every((item) =>
          new Prisma.Decimal(item.quantityReceived).gte(item.quantityOrdered),
        );
        const someReceived = updatedItems.some((item) =>
          new Prisma.Decimal(item.quantityReceived).gt(0),
        );

        const newStatus = allReceived
          ? PurchaseOrderStatus.RECEIVED
          : someReceived
            ? PurchaseOrderStatus.PARTIALLY_RECEIVED
            : po.status;

        return tx.purchaseOrder.update({
          where: { id },
          data: {
            status: newStatus,
            receivedAt: allReceived ? new Date() : undefined,
          },
          include: {
            supplier: { select: { id: true, name: true } },
            items: {
              include: {
                stockItem: {
                  select: { id: true, name: true, unit: true, branchId: true },
                },
              },
            },
          },
        });
      },
      // Mirrors stock-deduction and sales-invoice: the read-modify-
      // write on quantityReceived + the FIFO batch insert + the
      // weighted-cost recompute all touch rows another concurrent
      // receive might touch. Serializable promotes the write-vs-write
      // race into a 40001 that Prisma retries against a fresh snapshot
      // — without it we'd silently double-receive or under-receive.
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * Cancel a PO. If any items were already received, reverse the stock
   * (and the batches created from this PO) with compensating
   * PO_CANCEL_REVERSAL movements — prior behaviour just logged a
   * warning and left stock inflated forever.
   */
  async cancel(id: string, scope: BranchScope, userId?: string) {
    // Cheap pre-flight rejection so the obvious "wrong status" case
    // doesn't burn a Serializable txn — the in-txn re-claim below is
    // what actually guards the race. findOne is branch-fenced, so a
    // cross-branch PO id is rejected before any stock is mutated.
    const po = await this.findOne(id, scope);
    if (
      po.status === PurchaseOrderStatus.RECEIVED ||
      po.status === PurchaseOrderStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Cannot cancel a purchase order with status "${po.status}".`,
      );
    }

    // deep-review M18: mirror receive(). The prior implementation
    // reversed stock from the OUTSIDE-txn findOne snapshot under the
    // default READ COMMITTED isolation. Two failure modes:
    //   (1) a receive() that committed between findOne and this txn was
    //       invisible — cancel decremented currentStock by the stale
    //       (smaller) quantityReceived yet zeroed ALL batches, leaving
    //       stock inflated / batches wrongly nulled; and
    //   (2) even with no concurrency, batches already partially consumed
    //       by FIFO deduction were force-zeroed and the gross
    //       quantityReceived was decremented — double-counting the
    //       consumption and potentially driving stock negative.
    // Fix: run under Serializable, re-read the PO/items/batches INSIDE
    // the txn, and reverse only the un-consumed batch remainder.
    return this.prisma.$transaction(
      async (tx) => {
        // Re-claim the PO inside the txn so a receive that committed
        // after the outer findOne is observed, and a concurrent cancel
        // can't double-reverse.
        const claimed = await tx.purchaseOrder.findFirst({
          where: { id, ...branchScope(scope) },
          include: { items: true },
        });
        if (!claimed) throw new NotFoundException("Purchase order not found");
        if (
          claimed.status === PurchaseOrderStatus.RECEIVED ||
          claimed.status === PurchaseOrderStatus.CANCELLED
        ) {
          throw new BadRequestException(
            `Cannot cancel a purchase order with status "${claimed.status}".`,
          );
        }

        for (const item of claimed.items) {
          const received = new Prisma.Decimal(item.quantityReceived);
          if (received.lte(0)) continue;

          // Reverse only what is still on hand in this PO's batches —
          // FIFO may have already consumed part of them. Sum the
          // remaining batch quantity and zero only that, so currentStock
          // is decremented by the actually-reversible amount, never
          // below what consumption already removed.
          const batches = await tx.stockBatch.findMany({
            where: { purchaseOrderItemId: item.id },
          });
          const remaining = batches.reduce(
            (acc, b) => acc.add(new Prisma.Decimal(b.quantity)),
            new Prisma.Decimal(0),
          );
          if (remaining.gt(0)) {
            await tx.stockItem.update({
              where: { id: item.stockItemId },
              data: { currentStock: { decrement: remaining as any } },
            });
            await tx.stockBatch.updateMany({
              where: { purchaseOrderItemId: item.id },
              data: { quantity: 0 as any },
            });
            await tx.ingredientMovement.create({
              data: {
                type: IngredientMovementType.PO_CANCEL_REVERSAL,
                // Record the actual reversed qty, not the gross received.
                quantity: remaining.neg() as any,
                costPerUnit: item.unitPrice,
                notes: `PO ${claimed.orderNumber} cancelled — reversing un-consumed received stock`,
                referenceType: "PURCHASE_ORDER",
                referenceId: claimed.id,
                stockItemId: item.stockItemId,
                branchId: scope.branchId,
                tenantId: scope.tenantId,
                createdById: userId,
              },
            });
          }
          await tx.purchaseOrderItem.update({
            where: { id: item.id },
            data: { quantityReceived: 0 as any },
          });
        }

        return tx.purchaseOrder.update({
          where: { id },
          data: { status: PurchaseOrderStatus.CANCELLED },
          include: {
            supplier: { select: { id: true, name: true } },
            items: {
              include: {
                stockItem: { select: { id: true, name: true, unit: true } },
              },
            },
          },
        });
      },
      // Mirrors receive(): the reversal's read-modify-write on
      // quantityReceived / currentStock / batches races a concurrent
      // receive. Serializable promotes the write-vs-write race into a
      // 40001 that Prisma retries against a fresh snapshot.
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
