import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreatePurchaseOrderDto } from '../dto/create-purchase-order.dto';
import { ReceivePurchaseOrderDto } from '../dto/receive-purchase-order.dto';
import { PurchaseOrderStatus, IngredientMovementType } from '../../../common/constants/stock-management.enum';
import { StockSettingsService } from './stock-settings.service';

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private prisma: PrismaService,
    private stockSettings: StockSettingsService,
  ) {}

  private async generatePONumber(tenantId: string): Promise<string> {
    const settings = await this.stockSettings.get(tenantId);
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${settings.poNumberPrefix}-${timestamp}-${random}`;
  }

  async findAll(tenantId: string, status?: string) {
    const where: any = { tenantId };
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

  async create(dto: CreatePurchaseOrderDto, tenantId: string) {
    // Verify supplier
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, tenantId },
    });
    if (!supplier) throw new BadRequestException('Supplier not found');

    // Verify stock items
    const stockItemIds = dto.items.map((i) => i.stockItemId);
    const stockItems = await this.prisma.stockItem.findMany({
      where: { id: { in: stockItemIds }, tenantId },
    });
    if (stockItems.length !== stockItemIds.length) {
      throw new BadRequestException('One or more stock items not found');
    }

    const orderNumber = await this.generatePONumber(tenantId);

    return this.prisma.purchaseOrder.create({
      data: {
        orderNumber,
        supplierId: dto.supplierId,
        notes: dto.notes,
        expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
        tenantId,
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

  async receive(id: string, dto: ReceivePurchaseOrderDto, tenantId: string) {
    const po = await this.findOne(id, tenantId);
    if (po.status !== PurchaseOrderStatus.SUBMITTED && po.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED) {
      throw new BadRequestException('Only submitted or partially received purchase orders can be received');
    }

    return this.prisma.$transaction(async (tx) => {
      for (const lineItem of dto.items) {
        const poItem = po.items.find((i) => i.id === lineItem.purchaseOrderItemId);
        if (!poItem) throw new BadRequestException(`Purchase order item ${lineItem.purchaseOrderItemId} not found`);

        const newReceived = Number(poItem.quantityReceived) + lineItem.quantityReceived;
        if (newReceived > Number(poItem.quantityOrdered)) {
          throw new BadRequestException(
            `Cannot receive more than ordered for ${poItem.stockItem.name}. Ordered: ${poItem.quantityOrdered}, Already received: ${poItem.quantityReceived}, Attempting: ${lineItem.quantityReceived}`,
          );
        }

        // Update PO item received quantity
        await tx.purchaseOrderItem.update({
          where: { id: poItem.id },
          data: { quantityReceived: newReceived },
        });

        // Update stock item current stock
        await tx.stockItem.update({
          where: { id: poItem.stockItemId },
          data: {
            currentStock: { increment: lineItem.quantityReceived },
            costPerUnit: Number(poItem.unitPrice),
          },
        });

        // Create batch if tracking expiry
        if (lineItem.batchNumber || lineItem.expiryDate) {
          await tx.stockBatch.create({
            data: {
              batchNumber: lineItem.batchNumber,
              quantity: lineItem.quantityReceived,
              costPerUnit: Number(poItem.unitPrice),
              expiryDate: lineItem.expiryDate ? new Date(lineItem.expiryDate) : undefined,
              stockItemId: poItem.stockItemId,
              purchaseOrderItemId: poItem.id,
              tenantId,
            },
          });
        }

        // Create movement record
        await tx.ingredientMovement.create({
          data: {
            type: IngredientMovementType.PO_RECEIVE,
            quantity: lineItem.quantityReceived,
            costPerUnit: Number(poItem.unitPrice),
            notes: `PO ${po.orderNumber}${dto.notes ? ` - ${dto.notes}` : ''}`,
            referenceType: 'PURCHASE_ORDER',
            referenceId: po.id,
            stockItemId: poItem.stockItemId,
            tenantId,
          },
        });
      }

      // Determine new PO status
      const updatedItems = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: id },
      });
      const allReceived = updatedItems.every(
        (item) => Number(item.quantityReceived) >= Number(item.quantityOrdered),
      );
      const someReceived = updatedItems.some((item) => Number(item.quantityReceived) > 0);

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
          items: { include: { stockItem: { select: { id: true, name: true, unit: true } } } },
        },
      });
    });
  }

  async cancel(id: string, tenantId: string) {
    const po = await this.findOne(id, tenantId);
    if (po.status === PurchaseOrderStatus.RECEIVED || po.status === PurchaseOrderStatus.CANCELLED) {
      throw new BadRequestException('Cannot cancel a received or already cancelled purchase order');
    }

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseOrderStatus.CANCELLED },
      include: {
        supplier: { select: { id: true, name: true } },
        items: { include: { stockItem: { select: { id: true, name: true, unit: true } } } },
      },
    });
  }
}
