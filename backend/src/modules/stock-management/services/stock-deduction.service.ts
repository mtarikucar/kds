import { Injectable, Logger } from '@nestjs/common';
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

  async deductForOrder(orderId: string, tenantId: string) {
    const settings = await this.stockSettings.get(tenantId);
    if (!settings.enableAutoDeduction) {
      this.logger.log(`Auto-deduction disabled for tenant ${tenantId}, skipping`);
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
        const stockItem = await tx.stockItem.findUnique({
          where: { id: deduction.stockItemId },
        });
        if (!stockItem) continue;

        const newStock = Number(stockItem.currentStock) - deduction.quantity;

        if (newStock < 0) {
          this.logger.warn(
            `Insufficient stock for ${deduction.stockItemName}: current=${stockItem.currentStock}, needed=${deduction.quantity}`,
          );
          // Still deduct but log warning - don't block order
        }

        await tx.stockItem.update({
          where: { id: deduction.stockItemId },
          data: { currentStock: Math.max(0, newStock) },
        });

        await tx.ingredientMovement.create({
          data: {
            type: IngredientMovementType.ORDER_DEDUCTION,
            quantity: -deduction.quantity,
            costPerUnit: Number(stockItem.costPerUnit),
            notes: `Order ${order.orderNumber}`,
            referenceType: 'ORDER',
            referenceId: orderId,
            stockItemId: deduction.stockItemId,
            tenantId,
          },
        });

        // Check if low stock alert needed
        if (newStock <= Number(stockItem.minStock)) {
          lowStockAlerts.push(deduction.stockItemName);
        }
      }

      this.logger.log(
        `Deducted ingredients for order ${order.orderNumber}: ${deductions.length} items`,
      );

      return { deductions, lowStockAlerts };
    });
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

        await tx.stockItem.update({
          where: { id: movement.stockItemId },
          data: { currentStock: { increment: reverseQty } },
        });

        await tx.ingredientMovement.create({
          data: {
            type: IngredientMovementType.IN,
            quantity: reverseQty,
            costPerUnit: movement.costPerUnit ? Number(movement.costPerUnit) : undefined,
            notes: `Reversal: Order cancellation (${movement.notes})`,
            referenceType: 'ORDER',
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
