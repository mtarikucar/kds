import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStockMovementDto } from './dto/create-stock-movement.dto';
import { StockMovementType } from '../../common/constants/order-status.enum';

@Injectable()
export class StockService {
  constructor(private prisma: PrismaService) {}

  async createMovement(
    createDto: CreateStockMovementDto,
    userId: string,
    tenantId: string,
  ) {
    // Verify product exists and belongs to tenant
    const product = await this.prisma.product.findFirst({
      where: {
        id: createDto.productId,
        tenantId,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found or does not belong to your tenant');
    }

    // Check if stock tracking is enabled
    if (!product.stockTracked) {
      throw new BadRequestException('Stock tracking is not enabled for this product');
    }

    return this.prisma.$transaction(async (tx) => {
      let newStock = product.currentStock;

      switch (createDto.type) {
        case StockMovementType.IN:
          newStock += createDto.quantity;
          break;
        case StockMovementType.OUT:
          newStock -= createDto.quantity;
          if (newStock < 0) {
            throw new BadRequestException('Insufficient stock');
          }
          break;
        case StockMovementType.ADJUSTMENT:
          newStock = createDto.quantity;
          break;
      }

      // Update product stock
      await tx.product.update({
        where: { id: createDto.productId },
        data: {
          currentStock: newStock,
          isAvailable: newStock > 0,
        },
      });

      // Create stock movement record
      return tx.stockMovement.create({
        data: {
          type: createDto.type,
          quantity: createDto.quantity,
          reason: createDto.reason,
          notes: createDto.notes,
          productId: createDto.productId,
          userId,
          tenantId,
        },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              currentStock: true,
            },
          },
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });
    });
  }

  async getMovements(
    tenantId: string,
    productId?: string,
    type?: StockMovementType,
    startDate?: Date,
    endDate?: Date,
  ) {
    const where: any = { tenantId };

    if (productId) {
      where.productId = productId;
    }

    if (type) {
      where.type = type;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = startDate;
      }
      if (endDate) {
        where.createdAt.lte = endDate;
      }
    }

    return this.prisma.stockMovement.findMany({
      where,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            currentStock: true,
            category: {
              select: {
                name: true,
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getLowStockAlerts(tenantId: string, threshold: number = 10) {
    const products = await this.prisma.product.findMany({
      where: {
        tenantId,
        stockTracked: true,
        currentStock: {
          lt: threshold,
        },
      },
      include: {
        category: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { currentStock: 'asc' },
    });

    return products.map((product) => ({
      id: product.id,
      name: product.name,
      currentStock: product.currentStock,
      categoryName: product.category.name,
      image: product.image,
      price: product.price,
      isAvailable: product.isAvailable,
    }));
  }

  async updateProductStock(
    productId: string,
    quantity: number,
    userId: string,
    tenantId: string,
  ) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        tenantId,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found or does not belong to your tenant');
    }

    if (!product.stockTracked) {
      throw new BadRequestException('Stock tracking is not enabled for this product');
    }

    return this.createMovement(
      {
        productId,
        type: StockMovementType.ADJUSTMENT,
        quantity,
        reason: 'Manual stock adjustment',
      },
      userId,
      tenantId,
    );
  }
}
