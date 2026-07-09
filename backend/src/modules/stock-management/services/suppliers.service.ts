import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import {
  CreateSupplierDto,
  UpdateSupplierDto,
  SupplierStockItemDto,
} from "../dto/create-supplier.dto";
import { BranchScope, branchScope } from "../../../common/scoping/branch-scope";

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  /**
   * Supplier scorecard — per-supplier PO count, on-time delivery %, fill rate
   * (received ÷ ordered qty) and total spend over a window. Turns the raw PO
   * history into the vendor-performance view purchasing uses to rank suppliers.
   */
  async getScorecard(scope: BranchScope, startDate?: Date, endDate?: Date) {
    const where: any = { ...branchScope(scope) };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }
    const pos = await this.prisma.purchaseOrder.findMany({
      where,
      select: {
        supplierId: true,
        status: true,
        expectedDate: true,
        receivedAt: true,
        items: {
          select: {
            quantityOrdered: true,
            quantityReceived: true,
            unitPrice: true,
          },
        },
      },
    });

    const agg = new Map<
      string,
      {
        poCount: number;
        receivedCount: number;
        onTimeCount: number;
        orderedQty: number;
        receivedQty: number;
        spendCents: number;
      }
    >();
    for (const po of pos) {
      const a = agg.get(po.supplierId) ?? {
        poCount: 0,
        receivedCount: 0,
        onTimeCount: 0,
        orderedQty: 0,
        receivedQty: 0,
        spendCents: 0,
      };
      a.poCount += 1;
      const isReceived =
        po.status === "RECEIVED" || po.status === "PARTIALLY_RECEIVED";
      if (isReceived && po.receivedAt) {
        a.receivedCount += 1;
        if (po.expectedDate && po.receivedAt <= po.expectedDate) {
          a.onTimeCount += 1;
        }
      }
      for (const it of po.items) {
        const ord = Number(it.quantityOrdered);
        const rec = Number(it.quantityReceived);
        a.orderedQty += ord;
        a.receivedQty += rec;
        a.spendCents += Math.round(rec * Number(it.unitPrice) * 100);
      }
      agg.set(po.supplierId, a);
    }

    const ids = [...agg.keys()];
    const suppliers = ids.length
      ? await this.prisma.supplier.findMany({
          where: { id: { in: ids }, tenantId: scope.tenantId },
          select: { id: true, name: true },
        })
      : [];
    const nameOf = new Map(suppliers.map((s) => [s.id, s.name]));
    const pct = (n: number, d: number) =>
      d > 0 ? Math.round((n / d) * 1000) / 10 : null;

    return {
      suppliers: ids
        .map((id) => {
          const a = agg.get(id)!;
          return {
            supplierId: id,
            supplierName: nameOf.get(id) ?? "Unknown",
            poCount: a.poCount,
            onTimePct: pct(a.onTimeCount, a.receivedCount),
            fillRatePct: pct(a.receivedQty, a.orderedQty),
            totalSpend: Math.round(a.spendCents) / 100,
          };
        })
        .sort((x, y) => y.totalSpend - x.totalSpend),
    };
  }

  async findAll(tenantId: string) {
    return this.prisma.supplier.findMany({
      where: { tenantId },
      include: {
        _count: { select: { supplierStockItems: true, purchaseOrders: true } },
      },
      orderBy: { name: "asc" },
    });
  }

  async findOne(id: string, tenantId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
      include: {
        supplierStockItems: {
          include: {
            stockItem: { select: { id: true, name: true, unit: true } },
          },
        },
        _count: { select: { purchaseOrders: true } },
      },
    });
    if (!supplier) throw new NotFoundException("Supplier not found");
    return supplier;
  }

  async create(dto: CreateSupplierDto, tenantId: string) {
    return this.prisma.supplier.create({
      data: { ...dto, tenantId },
    });
  }

  async update(id: string, dto: UpdateSupplierDto, tenantId: string) {
    await this.findOne(id, tenantId);
    // Compound WHERE so a regression in findOne (e.g. someone replaces
    // findFirst with findUnique without re-checking tenantId) can't leak
    // into a cross-tenant supplier rename. Same defense-in-depth pattern
    // `removeStockItem` already uses below.
    const claim = await this.prisma.supplier.updateMany({
      where: { id, tenantId },
      data: dto,
    });
    if (claim.count === 0) throw new NotFoundException("Supplier not found");
    return this.prisma.supplier.findFirstOrThrow({ where: { id, tenantId } });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    // One txn so the three reference checks + delete see a consistent snapshot
    // and commit atomically. This reliably blocks the COMMON case (deleting a
    // supplier that already has POs / invoices / expenses).
    //
    // Known residual (accepted, LOW): it does NOT close the microsecond race
    // where an invoice/expense is inserted for this supplier AFTER the counts
    // read 0 but BEFORE the delete commits. Postgres SSI can't serialize
    // against the create paths because they run at READ COMMITTED and (for
    // expenses) never read the supplier row, so there's no rw-edge to abort on.
    // Consequence is only an orphaned scalar supplierId (no DB FK by design)
    // that AP-aging renders as "—" — no corruption. Fully closing it would
    // need a DB FK (safe now: these tables are new/empty) or a shared advisory
    // lock in the create paths; deferred rather than wrap a money path.
    return this.prisma.$transaction(
      async (tx) => {
        // Check if supplier has any non-cancelled POs
        const activePOs = await tx.purchaseOrder.count({
          where: {
            supplierId: id,
            status: { notIn: ["CANCELLED", "RECEIVED"] },
          },
        });
        if (activePOs > 0) {
          throw new BadRequestException(
            "Cannot delete supplier with active purchase orders",
          );
        }
        // AP invoices/expenses reference the supplier by scalar id (no DB FK) —
        // deleting would orphan the financial trail (AP aging shows "—", audits
        // lose the vendor). Block instead of silently orphaning.
        const [invoices, expenses] = await Promise.all([
          tx.purchaseInvoice.count({
            where: { supplierId: id, tenantId },
          }),
          tx.expense.count({ where: { supplierId: id, tenantId } }),
        ]);
        if (invoices > 0 || expenses > 0) {
          throw new BadRequestException(
            "Cannot delete a supplier with recorded invoices or expenses",
          );
        }
        const claim = await tx.supplier.deleteMany({
          where: { id, tenantId },
        });
        if (claim.count === 0) {
          throw new NotFoundException("Supplier not found");
        }
        return { id };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async addStockItem(
    supplierId: string,
    dto: SupplierStockItemDto,
    tenantId: string,
  ) {
    await this.findOne(supplierId, tenantId);

    const stockItem = await this.prisma.stockItem.findFirst({
      where: { id: dto.stockItemId, tenantId },
    });
    if (!stockItem) throw new BadRequestException("Stock item not found");

    return this.prisma.supplierStockItem.upsert({
      where: {
        supplierId_stockItemId: { supplierId, stockItemId: dto.stockItemId },
      },
      create: {
        supplierId,
        stockItemId: dto.stockItemId,
        supplierSku: dto.supplierSku,
        unitPrice: dto.unitPrice,
        isPreferred: dto.isPreferred || false,
      },
      update: {
        supplierSku: dto.supplierSku,
        unitPrice: dto.unitPrice,
        isPreferred: dto.isPreferred,
      },
      include: { stockItem: { select: { id: true, name: true, unit: true } } },
    });
  }

  async removeStockItem(
    supplierId: string,
    stockItemId: string,
    tenantId: string,
  ) {
    // findOne validates the supplier belongs to the tenant. The composite
    // key on SupplierStockItem isn't tenant-scoped in the schema, so even
    // after the pre-check a parallel deleteMany with a tenant predicate
    // is the canonical IDOR guard — only deletes when *both* the supplier
    // and the stock item belong to the calling tenant.
    await this.findOne(supplierId, tenantId);
    const result = await this.prisma.supplierStockItem.deleteMany({
      where: {
        supplierId,
        stockItemId,
        supplier: { tenantId },
        stockItem: { tenantId },
      },
    });
    if (result.count === 0) {
      throw new BadRequestException("Supplier-stock association not found");
    }
    return { supplierId, stockItemId };
  }
}
