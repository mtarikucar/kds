import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { TransferTableOrdersDto } from "../dto/transfer-table.dto";
import { OrderStatus } from "../../../common/constants/order-status.enum";
import { TableStatus } from "../../tables/dto/create-table.dto";
import { KdsGateway } from "../../kds/kds.gateway";
import { BranchScope, branchScope } from "../../../common/scoping/branch-scope";

/**
 * Extracted from OrdersService (god-file split, track5). Owns the
 * table-to-table order transfer flow: validation, FOR UPDATE table
 * locks, the transactional re-verify + move, and the post-commit KDS
 * WebSocket emit. Behaviour is identical to the previous
 * OrdersService.transferTableOrders — guarded by orders.transfer.spec.ts.
 */
@Injectable()
export class OrderTransferService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => KdsGateway))
    private kdsGateway: KdsGateway,
  ) {}

  async transferTableOrders(scope: BranchScope, dto: TransferTableOrdersDto) {
    const tenantId = scope.tenantId;
    const { sourceTableId, targetTableId, allowMerge = true } = dto;

    // Validate: source and target cannot be the same
    if (sourceTableId === targetTableId) {
      throw new BadRequestException(
        "Source and target tables cannot be the same",
      );
    }

    // v3.0.0 — source AND target must live in the caller's branch.
    // A waiter in branch A can't shove an order onto a sister-branch
    // table; refuse before any state change.
    const sourceTable = await this.prisma.table.findFirst({
      where: { id: sourceTableId, ...branchScope(scope) },
    });

    if (!sourceTable) {
      throw new NotFoundException("Source table not found in current branch");
    }

    const targetTable = await this.prisma.table.findFirst({
      where: { id: targetTableId, ...branchScope(scope) },
    });

    if (!targetTable) {
      throw new NotFoundException("Target table not found in current branch");
    }

    // Cannot transfer to a RESERVED table
    if (targetTable.status === TableStatus.RESERVED) {
      throw new BadRequestException(
        "Cannot transfer orders to a reserved table",
      );
    }

    // Check if target table has active orders (occupied)
    if (targetTable.status === TableStatus.OCCUPIED && !allowMerge) {
      throw new BadRequestException(
        "Target table has active orders. Set allowMerge to true to merge orders.",
      );
    }

    // Find active orders on source table (exclude PAID, CANCELLED, PENDING_APPROVAL)
    const activeOrders = await this.prisma.order.findMany({
      where: {
        tableId: sourceTableId,
        ...branchScope(scope),
        status: {
          notIn: [
            OrderStatus.PAID,
            OrderStatus.CANCELLED,
            OrderStatus.PENDING_APPROVAL,
          ],
        },
      },
      include: {
        orderItems: {
          include: {
            product: {
              select: { id: true, name: true, price: true, image: true },
            },
            modifiers: {
              include: {
                modifier: {
                  select: { id: true, name: true, priceAdjustment: true },
                },
              },
            },
          },
        },
        table: { select: { id: true, number: true, section: true } },
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (activeOrders.length === 0) {
      throw new BadRequestException("No active orders found on source table");
    }

    // Perform the transfer in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // v2.8.97 — lock both tables FOR UPDATE in deterministic id-sort
      // order before any write. Pre-fix two concurrent transfers
      // touching the same source/target tables could leave the source
      // marked AVAILABLE while another transfer's orders were still
      // moving to it, OR leave the target marked OCCUPIED when no
      // orders actually arrived. The lock order (string-sort ASC) is
      // shared with other order/table mutators so deadlocks can't
      // form across paths.
      const [firstLockId, secondLockId] = [sourceTableId, targetTableId].sort();
      await tx.$queryRaw`SELECT id FROM tables WHERE id = ${firstLockId} AND "tenantId" = ${scope.tenantId} AND "branchId" = ${scope.branchId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM tables WHERE id = ${secondLockId} AND "tenantId" = ${scope.tenantId} AND "branchId" = ${scope.branchId} FOR UPDATE`;

      // Re-verify the source still has the active orders we read
      // outside the lock — a concurrent payment / cancel between the
      // pre-tx findMany and this txn's lock could have terminated
      // them, in which case the transfer is a no-op rather than a
      // silent table-status flip.
      const stillActiveIds = await tx.order.findMany({
        where: {
          id: { in: activeOrders.map((o) => o.id) },
          ...branchScope(scope),
          tableId: sourceTableId,
          status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
        },
        select: { id: true },
      });
      if (stillActiveIds.length === 0) {
        throw new BadRequestException(
          "All source-table orders changed status while waiting for the table lock — refresh and retry.",
        );
      }

      // Compound WHERE on scope — defence-in-depth so a regression
      // in the pre-validation above can't be amplified by an
      // unconditional updateMany. v3.0.0 adds branchId.
      await tx.order.updateMany({
        where: {
          id: { in: stillActiveIds.map((o) => o.id) },
          ...branchScope(scope),
        },
        data: {
          tableId: targetTableId,
        },
      });

      // Update source table to AVAILABLE only if no other active
      // orders remain (a parallel transfer pointing TO the source
      // could have just added some).
      const remainingOnSource = await tx.order.count({
        where: {
          tableId: sourceTableId,
          ...branchScope(scope),
          status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
        },
      });
      if (remainingOnSource === 0) {
        await tx.table.updateMany({
          where: { id: sourceTableId, ...branchScope(scope) },
          data: { status: TableStatus.AVAILABLE },
        });
      }

      // Update target table to OCCUPIED
      await tx.table.updateMany({
        where: { id: targetTableId, ...branchScope(scope) },
        data: { status: TableStatus.OCCUPIED },
      });

      // Fetch updated orders with new table info
      const updatedOrders = await tx.order.findMany({
        where: {
          id: { in: activeOrders.map((o) => o.id) },
        },
        include: {
          orderItems: {
            include: {
              product: {
                select: { id: true, name: true, price: true, image: true },
              },
              modifiers: {
                include: {
                  modifier: {
                    select: { id: true, name: true, priceAdjustment: true },
                  },
                },
              },
            },
          },
          table: { select: { id: true, number: true, section: true } },
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      return updatedOrders;
    });

    // Emit WebSocket event for table transfer
    this.kdsGateway.emitTableTransfer(tenantId, sourceTable.branchId, {
      sourceTableId,
      targetTableId,
      sourceTableNumber: sourceTable.number,
      targetTableNumber: targetTable.number,
      orders: result,
      transferredCount: result.length,
    });

    return {
      message: `Successfully transferred ${result.length} order(s) from table ${sourceTable.number} to table ${targetTable.number}`,
      transferredOrders: result,
      sourceTable: {
        id: sourceTableId,
        number: sourceTable.number,
        newStatus: TableStatus.AVAILABLE,
      },
      targetTable: {
        id: targetTableId,
        number: targetTable.number,
        newStatus: TableStatus.OCCUPIED,
      },
    };
  }
}
