import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreatePurchaseOrderDto } from '../dto/create-purchase-order.dto';
import { ReceivePurchaseOrderDto } from '../dto/receive-purchase-order.dto';
import {
  PurchaseOrderStatus,
  IngredientMovementType,
} from '../../../common/constants/stock-management.enum';

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
    const settings = await tx.stockSettings.upsert({
      where: { tenantId },
      create: { tenantId, poSequence: 1 },
      update: { poSequence: { increment: 1 } },
    });
    const seq = String(settings.poSequence).padStart(5, '0');
    return `${settings.poNumberPrefix}-${seq}`;
  }

  async findAll(tenantId: string, status?: string) {
    const where: Prisma.PurchaseOrderWhereInput = { tenantId };
    if (status) where.status = status;

    return this.prisma.purchaseOrder.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true } },
        items: {
          include: { stockItem: { select: { id: true, name: true, unit: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, tenantId: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId },
      include: {
        supplier: true,
        items: {
          include: { stockItem: { select: { id: true, name: true, unit: true } } },
        },
      },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    return po;
  }

  async create(dto: CreatePurchaseOrderDto, tenantId: string, userId?: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, tenantId },
    });
    if (!supplier) throw new BadRequestException('Supplier not found');

    const stockItemIds = dto.items.map((i) => i.stockItemId);
    const stockItems = await this.prisma.stockItem.findMany({
      where: { id: { in: stockItemIds }, tenantId },
    });
    if (stockItems.length !== stockItemIds.length) {
      throw new BadRequestException('One or more stock items not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const orderNumber = await this.allocatePoNumber(tx, tenantId);
      return tx.purchaseOrder.create({
        data: {
          orderNumber,
          supplierId: dto.supplierId,
          notes: dto.notes,
          expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
          tenantId,
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
            include: { stockItem: { select: { id: true, name: true, unit: true } } },
          },
        },
      });
    });
  }

  async submit(id: string, tenantId: string) {
    const po = await this.findOne(id, tenantId);
    if (po.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException('Only draft purchase orders can be submitted');
    }

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseOrderStatus.SUBMITTED, submittedAt: new Date() },
      include: {
        supplier: { select: { id: true, name: true } },
        items: { include: { stockItem: { select: { id: true, name: true, unit: true } } } },
      },
    });
  }

  async receive(
    id: string,
    dto: ReceivePurchaseOrderDto,
    tenantId: string,
    userId?: string,
  ) {
    const po = await this.findOne(id, tenantId);
    if (
      po.status !== PurchaseOrderStatus.SUBMITTED &&
      po.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED
    ) {
      throw new BadRequestException(
        'Only submitted or partially received purchase orders can be received',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      for (const lineItem of dto.items) {
        const poItem = po.items.find((i) => i.id === lineItem.purchaseOrderItemId);
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
          throw new BadRequestException('Stock item disappeared');
        }
        const existingStock = new Prisma.Decimal(stockItem.currentStock);
        const existingCost = new Prisma.Decimal(stockItem.costPerUnit ?? 0);
        const unitPrice = new Prisma.Decimal(poItem.unitPrice);
        const newStock = existingStock.add(receivedQty);
        const weightedCost = newStock.isZero()
          ? unitPrice
          : existingStock.mul(existingCost).add(receivedQty.mul(unitPrice)).div(newStock);

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
            expiryDate: lineItem.expiryDate ? new Date(lineItem.expiryDate) : undefined,
            stockItemId: poItem.stockItemId,
            purchaseOrderItemId: poItem.id,
            tenantId,
          },
        });

        await tx.ingredientMovement.create({
          data: {
            type: IngredientMovementType.PO_RECEIVE,
            quantity: receivedQty as any,
            costPerUnit: unitPrice as any,
            notes: `PO ${po.orderNumber}${dto.notes ? ` - ${dto.notes}` : ''}`,
            referenceType: 'PURCHASE_ORDER',
            referenceId: po.id,
            stockItemId: poItem.stockItemId,
            tenantId,
            createdById: userId,
          },
        });
      }

      const updatedItems = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: id },
      });
      const allReceived = updatedItems.every(
        (item) => new Prisma.Decimal(item.quantityReceived).gte(item.quantityOrdered),
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
            include: { stockItem: { select: { id: true, name: true, unit: true } } },
          },
        },
      });
    });
  }

  /**
   * Cancel a PO. If any items were already received, reverse the stock
   * (and the batches created from this PO) with compensating
   * PO_CANCEL_REVERSAL movements — prior behaviour just logged a
   * warning and left stock inflated forever.
   */
  async cancel(id: string, tenantId: string, userId?: string) {
    const po = await this.findOne(id, tenantId);
    if (
      po.status === PurchaseOrderStatus.RECEIVED ||
      po.status === PurchaseOrderStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Cannot cancel a purchase order with status "${po.status}".`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      for (const item of po.items) {
        const received = new Prisma.Decimal(item.quantityReceived);
        if (received.lte(0)) continue;

        await tx.stockItem.update({
          where: { id: item.stockItemId },
          data: { currentStock: { decrement: received as any } },
        });
        await tx.stockBatch.updateMany({
          where: { purchaseOrderItemId: item.id },
          data: { quantity: 0 as any },
        });
        await tx.ingredientMovement.create({
          data: {
            type: IngredientMovementType.PO_CANCEL_REVERSAL,
            quantity: received.neg() as any,
            costPerUnit: item.unitPrice,
            notes: `PO ${po.orderNumber} cancelled — reversing received stock`,
            referenceType: 'PURCHASE_ORDER',
            referenceId: po.id,
            stockItemId: item.stockItemId,
            tenantId,
            createdById: userId,
          },
        });
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
            include: { stockItem: { select: { id: true, name: true, unit: true } } },
          },
        },
      });
    });
  }
}
