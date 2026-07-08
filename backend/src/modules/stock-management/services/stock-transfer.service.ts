import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { BranchScope } from "../../../common/scoping/branch-scope";

interface CreateTransferInput {
  toBranchId: string;
  notes?: string;
  items: Array<{
    sourceStockItemId: string;
    destStockItemId: string;
    quantity: number;
    unitCost?: number;
  }>;
}

/**
 * Inter-branch stock transfer. Create records a PENDING transfer (from the
 * caller's branch to another); complete atomically moves the stock — decrement
 * each source item, increment the mapped destination item, and write a
 * TRANSFER_OUT / TRANSFER_IN movement on each side, all under Serializable
 * isolation with a claim-first status flip so a concurrent complete can't
 * double-move. Source shortfall aborts (and rolls back) the whole transfer.
 */
@Injectable()
export class StockTransferService {
  constructor(private prisma: PrismaService) {}

  async create(scope: BranchScope, userId: string, dto: CreateTransferInput) {
    if (dto.toBranchId === scope.branchId) {
      throw new BadRequestException("Cannot transfer to the same branch");
    }
    const toBranch = await this.prisma.branch.findFirst({
      where: { id: dto.toBranchId, tenantId: scope.tenantId },
      select: { id: true },
    });
    if (!toBranch) {
      throw new BadRequestException("Destination branch not found");
    }

    // Validate every line's source item is in the caller's branch and the dest
    // item is in the destination branch (fail early; complete() also guards).
    const srcIds = [...new Set(dto.items.map((i) => i.sourceStockItemId))];
    const dstIds = [...new Set(dto.items.map((i) => i.destStockItemId))];
    const [srcOwned, dstOwned] = await Promise.all([
      this.prisma.stockItem.count({
        where: {
          id: { in: srcIds },
          tenantId: scope.tenantId,
          branchId: scope.branchId,
        },
      }),
      this.prisma.stockItem.count({
        where: {
          id: { in: dstIds },
          tenantId: scope.tenantId,
          branchId: dto.toBranchId,
        },
      }),
    ]);
    if (srcOwned !== srcIds.length) {
      throw new BadRequestException(
        "One or more source items are not in your branch",
      );
    }
    if (dstOwned !== dstIds.length) {
      throw new BadRequestException(
        "One or more destination items are not in the destination branch",
      );
    }

    const count = await this.prisma.stockTransfer.count({
      where: { tenantId: scope.tenantId },
    });
    const transferNumber = `TRF-${String(count + 1).padStart(5, "0")}`;

    return this.prisma.stockTransfer.create({
      data: {
        tenantId: scope.tenantId,
        fromBranchId: scope.branchId,
        toBranchId: dto.toBranchId,
        transferNumber,
        notes: dto.notes ?? null,
        createdById: userId,
        items: {
          create: dto.items.map((i) => ({
            sourceStockItemId: i.sourceStockItemId,
            destStockItemId: i.destStockItemId,
            quantity: new Prisma.Decimal(i.quantity),
            unitCost:
              i.unitCost != null ? new Prisma.Decimal(i.unitCost) : null,
          })),
        },
      },
      include: { items: true },
    });
  }

  async complete(scope: BranchScope, transferId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const claim = await tx.stockTransfer.updateMany({
          where: {
            id: transferId,
            tenantId: scope.tenantId,
            status: "PENDING",
          },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
        if (claim.count === 0) {
          throw new BadRequestException("Transfer not found or not pending");
        }
        const transfer = await tx.stockTransfer.findUnique({
          where: { id: transferId },
          include: { items: true },
        });
        if (!transfer) throw new BadRequestException("Transfer not found");

        for (const item of transfer.items) {
          const dec = await tx.stockItem.updateMany({
            where: {
              id: item.sourceStockItemId,
              tenantId: scope.tenantId,
              branchId: transfer.fromBranchId,
              currentStock: { gte: item.quantity as any },
            },
            data: { currentStock: { decrement: item.quantity as any } },
          });
          if (dec.count === 0) {
            throw new ConflictException(
              "Insufficient stock at source for a transfer item",
            );
          }
          const inc = await tx.stockItem.updateMany({
            where: {
              id: item.destStockItemId,
              tenantId: scope.tenantId,
              branchId: transfer.toBranchId,
            },
            data: { currentStock: { increment: item.quantity as any } },
          });
          // If the destination item isn't in toBranch, the increment matches 0
          // rows. Without this guard the source is decremented and the stock
          // vanishes — abort (rolls back the whole transfer) instead.
          if (inc.count === 0) {
            throw new BadRequestException(
              "Destination stock item not found in the destination branch",
            );
          }
          await tx.ingredientMovement.create({
            data: {
              type: "TRANSFER_OUT",
              quantity: new Prisma.Decimal(item.quantity).neg() as any,
              costPerUnit: item.unitCost ?? undefined,
              notes: `Transfer ${transfer.transferNumber}`,
              referenceType: "STOCK_TRANSFER",
              referenceId: transfer.id,
              stockItemId: item.sourceStockItemId,
              tenantId: scope.tenantId,
              branchId: transfer.fromBranchId,
              createdById: scope.userId,
            },
          });
          await tx.ingredientMovement.create({
            data: {
              type: "TRANSFER_IN",
              quantity: item.quantity as any,
              costPerUnit: item.unitCost ?? undefined,
              notes: `Transfer ${transfer.transferNumber}`,
              referenceType: "STOCK_TRANSFER",
              referenceId: transfer.id,
              stockItemId: item.destStockItemId,
              tenantId: scope.tenantId,
              branchId: transfer.toBranchId,
              createdById: scope.userId,
            },
          });
        }
        return tx.stockTransfer.findUnique({
          where: { id: transferId },
          include: { items: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async cancel(scope: BranchScope, transferId: string) {
    const claim = await this.prisma.stockTransfer.updateMany({
      where: { id: transferId, tenantId: scope.tenantId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    if (claim.count === 0) {
      throw new BadRequestException("Transfer not found or not pending");
    }
    return { id: transferId, status: "CANCELLED" };
  }

  async list(scope: BranchScope) {
    return this.prisma.stockTransfer.findMany({
      where: {
        tenantId: scope.tenantId,
        OR: [{ fromBranchId: scope.branchId }, { toBranchId: scope.branchId }],
      },
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
}
