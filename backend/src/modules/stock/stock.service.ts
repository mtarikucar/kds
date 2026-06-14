import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Optional,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateStockMovementDto } from "./dto/create-stock-movement.dto";
import { StockMovementType } from "../../common/constants/order-status.enum";
import { BranchScope, branchScope } from "../../common/scoping/branch-scope";
import { MetricsService } from "../../common/metrics/metrics.service";

@Injectable()
export class StockService {
  constructor(
    private prisma: PrismaService,
    // Optional so unit tests constructing the service bare keep working.
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async createMovement(
    createDto: CreateStockMovementDto,
    userId: string,
    tenantId: string,
    branchId: string,
  ) {
    // Verify product exists and belongs to tenant
    const product = await this.prisma.product.findFirst({
      where: {
        id: createDto.productId,
        tenantId,
      },
    });

    if (!product) {
      throw new NotFoundException(
        "Product not found or does not belong to your tenant",
      );
    }

    // Check if stock tracking is enabled
    if (!product.stockTracked) {
      throw new BadRequestException(
        "Stock tracking is not enabled for this product",
      );
    }

    const movement = await this.prisma.$transaction(async (tx) => {
      // Apply the stock change via a conditional update so two concurrent
      // OUT movements can't both read stock=10 and each decrement — the
      // second loser sees `count: 0` and we raise insufficient-stock. For
      // ADJUSTMENT we write the literal quantity (explicit override) and
      // for IN we just increment.
      //
      // v2.8.98 — `currentStock` is Prisma.Decimal; the local `newStock`
      // accumulator is a Decimal so the post-write isAvailable flag
      // routes through .gt(0).
      let newStock: Prisma.Decimal;
      switch (createDto.type) {
        case StockMovementType.IN: {
          const res = await tx.product.updateMany({
            where: { id: createDto.productId, tenantId },
            data: {
              currentStock: { increment: createDto.quantity },
            },
          });
          if (res.count !== 1) {
            throw new NotFoundException("Product not found");
          }
          const fresh = await tx.product.findUniqueOrThrow({
            where: { id: createDto.productId },
            select: { currentStock: true },
          });
          newStock = new Prisma.Decimal(fresh.currentStock);
          break;
        }
        case StockMovementType.OUT: {
          const res = await tx.product.updateMany({
            where: {
              id: createDto.productId,
              tenantId,
              currentStock: { gte: createDto.quantity },
            },
            data: {
              currentStock: { decrement: createDto.quantity },
            },
          });
          if (res.count !== 1) {
            throw new BadRequestException("Insufficient stock");
          }
          const fresh = await tx.product.findUniqueOrThrow({
            where: { id: createDto.productId },
            select: { currentStock: true },
          });
          newStock = new Prisma.Decimal(fresh.currentStock);
          break;
        }
        case StockMovementType.ADJUSTMENT: {
          if (createDto.quantity < 0) {
            throw new BadRequestException("Adjustment quantity must be >= 0");
          }
          newStock = new Prisma.Decimal(createDto.quantity);
          const res = await tx.product.updateMany({
            where: { id: createDto.productId, tenantId },
            data: { currentStock: newStock as any },
          });
          if (res.count !== 1) {
            throw new NotFoundException("Product not found");
          }
          break;
        }
      }

      // Separate write to sync isAvailable — not gated by the previous
      // conditional so ADJUSTMENT to 0 or IN after 0 flips the flag.
      await tx.product.update({
        where: { id: createDto.productId },
        data: {
          isAvailable: newStock.gt(0),
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
          // v3.0.0 — branch scope propagated from controller's BranchScope.
          branchId,
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

    // Track 2 — record the committed movement for Prometheus (IN/OUT/
    // ADJUSTMENT throughput). After-commit + optional so it can never break
    // the business write.
    this.metrics?.incCounter(
      "stock_movements_total",
      "Stock movements by type (IN|OUT|ADJUSTMENT)",
      { type: createDto.type },
    );

    return movement;
  }

  /**
   * Hard cap on a single getMovements page. A long-lived tenant can
   * accumulate hundreds of thousands of stock movements; without this
   * the unbounded findMany would happily try to serialise the whole
   * table into one response and OOM the API process. 500 is generous
   * for the "scroll back through recent activity" UI use case.
   */
  private static readonly MOVEMENTS_PAGE_HARD_CAP = 500;

  async getMovements(
    scope: BranchScope,
    productId?: string,
    type?: StockMovementType,
    startDate?: Date,
    endDate?: Date,
    limit?: number,
  ) {
    // v3.0.0 — branch-scoped. StockMovement carries `branchId` (Restrict
    // FK to Branch) so a MANAGER on branch A can no longer enumerate
    // branch B's movements via GET /stock/movements.
    const where: any = { ...branchScope(scope) };

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

    const safeTake = Math.min(
      Math.max(Math.floor(limit ?? 100), 1),
      StockService.MOVEMENTS_PAGE_HARD_CAP,
    );

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
      orderBy: { createdAt: "desc" },
      take: safeTake,
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
      orderBy: { currentStock: "asc" },
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
    branchId: string,
  ) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        tenantId,
      },
    });

    if (!product) {
      throw new NotFoundException(
        "Product not found or does not belong to your tenant",
      );
    }

    if (!product.stockTracked) {
      throw new BadRequestException(
        "Stock tracking is not enabled for this product",
      );
    }

    return this.createMovement(
      {
        productId,
        type: StockMovementType.ADJUSTMENT,
        quantity,
        reason: "Manual stock adjustment",
      },
      userId,
      tenantId,
      branchId,
    );
  }
}
