import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { IngredientMovementType } from '../../../common/constants/stock-management.enum';
import { StockSettingsService } from './stock-settings.service';

@Injectable()
export class StockDeductionService {
  private readonly logger = new Logger(StockDeductionService.name);

  constructor(
    private prisma: PrismaService,
    private stockSettings: StockSettingsService,
  ) {}

  async deductForOrder(orderId: string, tenantId: string, currentStatus?: string) {
    const settings = await this.stockSettings.get(tenantId);
    if (!settings.enableAutoDeduction) {
      this.logger.log(`Auto-deduction disabled for tenant ${tenantId}, skipping`);
      return;
    }

    // Only deduct at the configured status (default: PREPARING)
    if (settings.deductOnStatus) {
      if (!currentStatus || currentStatus !== settings.deductOnStatus) {
        return;
      }
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

    if (!order) {
      this.logger.warn(`Order ${orderId} not found for deduction`);
      return;
    }

    const deductions: { stockItemId: string; quantity: number; stockItemName: string }[] = [];

    for (const orderItem of order.orderItems) {
      const recipe = orderItem.product.recipe;
      if (!recipe) continue;

      for (const ingredient of recipe.ingredients) {
        const quantityNeeded = (Number(ingredient.quantity) / recipe.yield) * orderItem.quantity;
        const existing = deductions.find((d) => d.stockItemId === ingredient.stockItemId);
        if (existing) {
          existing.quantity += quantityNeeded;
        } else {
          deductions.push({
            stockItemId: ingredient.stockItemId,
            quantity: quantityNeeded,
            stockItemName: ingredient.stockItem.name,
          });
        }
      }
    }

    if (deductions.length === 0) {
      this.logger.log(`No recipes found for order ${order.orderNumber}, skipping ingredient deduction`);
      return;
    }

    return this.prisma.$transaction(async (tx) => {
      const lowStockAlerts: string[] = [];

      for (const deduction of deductions) {
        const stockItem = await tx.stockItem.findFirst({
          where: { id: deduction.stockItemId, tenantId },
        });
        if (!stockItem) continue;

        const currentStock = Number(stockItem.currentStock);

        if (currentStock < deduction.quantity) {
          this.logger.warn(
            `Insufficient stock for ${deduction.stockItemName}: current=${currentStock}, needed=${deduction.quantity}`,
          );
        }

        const deductAmount = Math.min(deduction.quantity, currentStock);
        await tx.stockItem.update({
          where: { id: deduction.stockItemId },
          data: { currentStock: { decrement: deductAmount } },
        });

        await tx.ingredientMovement.create({
          data: {
            type: IngredientMovementType.ORDER_DEDUCTION,
            quantity: -deductAmount,
            costPerUnit: Number(stockItem.costPerUnit),
            notes: `Order ${order.orderNumber}`,
            referenceType: 'ORDER',
            referenceId: orderId,
            stockItemId: deduction.stockItemId,
            tenantId,
          },
        });

        // Check if low stock alert needed
        const newStock = currentStock - deductAmount;
        if (newStock <= Number(stockItem.minStock)) {
          lowStockAlerts.push(deduction.stockItemName);
        }
      }

      this.logger.log(
        `Deducted ingredients for order ${order.orderNumber}: ${deductions.length} items`,
      );

      return { deductions, lowStockAlerts };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async reverseForOrder(orderId: string, tenantId: string) {
    // Find all deduction movements for this order
    const movements = await this.prisma.ingredientMovement.findMany({
      where: {
        tenantId,
        type: IngredientMovementType.ORDER_DEDUCTION,
        referenceType: 'ORDER',
        referenceId: orderId,
      },
    });

    if (movements.length === 0) return;

    return this.prisma.$transaction(async (tx) => {
      for (const movement of movements) {
        // Reverse the deduction (add back)
        const reverseQty = Math.abs(Number(movement.quantity));

        // Verify stock item belongs to tenant before updating
        const stockItem = await tx.stockItem.findFirst({
          where: { id: movement.stockItemId, tenantId },
        });
        if (!stockItem) continue;

        await tx.stockItem.update({
          where: { id: movement.stockItemId },
          data: { currentStock: { increment: reverseQty } },
        });

        await tx.ingredientMovement.create({
          data: {
            type: IngredientMovementType.ADJUSTMENT,
            quantity: reverseQty,
            costPerUnit: movement.costPerUnit ? Number(movement.costPerUnit) : undefined,
            notes: `Reversal: Order cancellation (${movement.notes})`,
            referenceType: 'ORDER_REVERSAL',
            referenceId: orderId,
            stockItemId: movement.stockItemId,
            tenantId,
          },
        });
      }

      this.logger.log(`Reversed ingredient deductions for order ${orderId}: ${movements.length} items`);
    });
  }
}
