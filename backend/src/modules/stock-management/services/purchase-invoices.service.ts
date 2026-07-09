import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { BranchScope, branchScope } from "../../../common/scoping/branch-scope";
import { drawDownBatchesFifo } from "../../../common/stock/batch-drawdown";

interface CreateInvoiceInput {
  supplierId: string;
  purchaseOrderId?: string;
  invoiceNumber: string;
  invoiceDate: string;
  subtotal: number;
  taxAmount: number;
  notes?: string;
}

const D = (v: Prisma.Decimal | number | string | null | undefined) =>
  v == null ? new Prisma.Decimal(0) : new Prisma.Decimal(v as any);

/**
 * Accounts-Payable vendor bills with a 3-way match. A bill can be linked to a
 * PurchaseOrder; on create (and on demand) the invoice total is matched against
 * what was actually RECEIVED (GRN = Σ quantityReceived × unitPrice). Within
 * tolerance (max of 1 kuruş / 1% of received) → MATCHED, otherwise DISCREPANCY
 * so it can't be approved/paid blind. taxAmount is the deductible input VAT
 * (indirilecek KDV). Bills are deduped per (supplier, invoiceNumber).
 */
@Injectable()
export class PurchaseInvoicesService {
  constructor(private prisma: PrismaService) {}

  private tolerance(receivedTotal: Prisma.Decimal): Prisma.Decimal {
    const onePct = receivedTotal.mul("0.01");
    return onePct.gt("0.01") ? onePct : new Prisma.Decimal("0.01");
  }

  /** 3-way match breakdown for a PO vs a given invoice total. */
  async computeMatch(
    scope: BranchScope,
    purchaseOrderId: string,
    invoiceTotal: Prisma.Decimal,
  ) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, ...branchScope(scope) },
      include: {
        items: {
          select: {
            quantityOrdered: true,
            quantityReceived: true,
            unitPrice: true,
          },
        },
      },
    });
    if (!po) {
      throw new BadRequestException("Linked purchase order not found");
    }

    const orderedTotal = po.items.reduce(
      (s, i) => s.add(D(i.quantityOrdered).mul(i.unitPrice)),
      new Prisma.Decimal(0),
    );
    const receivedTotal = po.items.reduce(
      (s, i) => s.add(D(i.quantityReceived).mul(i.unitPrice)),
      new Prisma.Decimal(0),
    );
    const variance = invoiceTotal.sub(receivedTotal);
    const tol = this.tolerance(receivedTotal);
    const matched = variance.abs().lte(tol);

    return {
      orderedTotal: orderedTotal.toDecimalPlaces(2).toNumber(),
      receivedTotal: receivedTotal.toDecimalPlaces(2).toNumber(),
      invoiceTotal: invoiceTotal.toDecimalPlaces(2).toNumber(),
      variance: variance.toDecimalPlaces(2).toNumber(),
      tolerance: tol.toDecimalPlaces(2).toNumber(),
      matched,
      status: matched ? "MATCHED" : "DISCREPANCY",
    };
  }

  async create(scope: BranchScope, userId: string, dto: CreateInvoiceInput) {
    // Tenant-ownership on the supplier (mirrors PurchaseOrdersService.create) —
    // a globally-unique supplier id must not be attachable across tenants.
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, tenantId: scope.tenantId },
      select: { id: true },
    });
    if (!supplier) throw new BadRequestException("Supplier not found");

    const dup = await this.prisma.purchaseInvoice.findFirst({
      where: {
        tenantId: scope.tenantId,
        supplierId: dto.supplierId,
        invoiceNumber: dto.invoiceNumber,
      },
    });
    if (dup) {
      throw new ConflictException(
        "An invoice with this number already exists for this supplier",
      );
    }

    const total = D(dto.subtotal).add(D(dto.taxAmount));
    let status = "RECEIVED";
    let matchVariance: Prisma.Decimal | null = null;
    if (dto.purchaseOrderId) {
      const match = await this.computeMatch(scope, dto.purchaseOrderId, total);
      status = match.status;
      matchVariance = new Prisma.Decimal(match.variance);
    }

    return this.prisma.purchaseInvoice.create({
      data: {
        tenantId: scope.tenantId,
        branchId: scope.branchId,
        supplierId: dto.supplierId,
        purchaseOrderId: dto.purchaseOrderId ?? null,
        invoiceNumber: dto.invoiceNumber,
        invoiceDate: new Date(dto.invoiceDate),
        subtotal: D(dto.subtotal),
        taxAmount: D(dto.taxAmount),
        total,
        status,
        matchVariance,
        notes: dto.notes ?? null,
        createdById: userId,
      },
    });
  }

  async list(
    scope: BranchScope,
    opts?: { status?: string; supplierId?: string; limit?: number },
  ) {
    return this.prisma.purchaseInvoice.findMany({
      where: {
        ...branchScope(scope),
        ...(opts?.status ? { status: opts.status } : {}),
        ...(opts?.supplierId ? { supplierId: opts.supplierId } : {}),
      },
      orderBy: { invoiceDate: "desc" },
      take: Math.min(opts?.limit ?? 50, 200),
    });
  }

  async getMatch(scope: BranchScope, invoiceId: string) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id: invoiceId, ...branchScope(scope) },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    if (!invoice.purchaseOrderId) {
      return { linked: false, invoiceTotal: Number(invoice.total) };
    }
    return {
      linked: true,
      ...(await this.computeMatch(
        scope,
        invoice.purchaseOrderId,
        D(invoice.total),
      )),
    };
  }

  /** Approve a matched/discrepant invoice (a DISCREPANCY needs a manager's ok). */
  async approve(scope: BranchScope, invoiceId: string) {
    const claim = await this.prisma.purchaseInvoice.updateMany({
      where: {
        id: invoiceId,
        ...branchScope(scope),
        status: { in: ["MATCHED", "DISCREPANCY", "RECEIVED"] },
      },
      data: { status: "APPROVED" },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        "Invoice not found or not in an approvable state",
      );
    }
    return this.prisma.purchaseInvoice.findFirst({
      where: { id: invoiceId, ...branchScope(scope) },
    });
  }

  /**
   * Accounts-Payable aging — unpaid vendor bills bucketed by how overdue they
   * are from the invoice date (current / 31-60 / 61-90 / 90+), totalled and
   * broken down by supplier. The classic "what do we owe and how late" view.
   */
  async getApAging(scope: BranchScope, asOf?: Date) {
    const now = asOf ?? new Date();
    const unpaid = await this.prisma.purchaseInvoice.findMany({
      where: { ...branchScope(scope), status: { not: "PAID" } },
      select: {
        id: true,
        supplierId: true,
        invoiceNumber: true,
        invoiceDate: true,
        total: true,
        status: true,
      },
    });

    const dayMs = 24 * 60 * 60 * 1000;
    const bucketOf = (age: number) =>
      age <= 30
        ? "current"
        : age <= 60
          ? "d31_60"
          : age <= 90
            ? "d61_90"
            : "d90plus";

    const buckets = { current: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
    const bySupplier = new Map<
      string,
      { supplierId: string; total: number; count: number }
    >();
    let total = 0;

    for (const inv of unpaid) {
      const age = Math.floor(
        (now.getTime() - new Date(inv.invoiceDate).getTime()) / dayMs,
      );
      const amt = Number(inv.total);
      buckets[bucketOf(age)] += amt;
      total += amt;
      const s = bySupplier.get(inv.supplierId) ?? {
        supplierId: inv.supplierId,
        total: 0,
        count: 0,
      };
      s.total += amt;
      s.count += 1;
      bySupplier.set(inv.supplierId, s);
    }

    // Resolve supplier names so the per-supplier table isn't opaque UUIDs.
    const supplierIds = [...bySupplier.keys()];
    const suppliers = supplierIds.length
      ? await this.prisma.supplier.findMany({
          where: { id: { in: supplierIds }, tenantId: scope.tenantId },
          select: { id: true, name: true },
        })
      : [];
    const nameOf = new Map(suppliers.map((s) => [s.id, s.name]));

    const r2 = (n: number) => Math.round(n * 100) / 100;
    return {
      asOf: now,
      total: r2(total),
      buckets: {
        current: r2(buckets.current),
        d31_60: r2(buckets.d31_60),
        d61_90: r2(buckets.d61_90),
        d90plus: r2(buckets.d90plus),
      },
      bySupplier: [...bySupplier.values()]
        .map((s) => ({
          ...s,
          supplierName: nameOf.get(s.supplierId) ?? "—",
          total: r2(s.total),
        }))
        .sort((a, b) => b.total - a.total),
    };
  }

  /**
   * Supplier return (RMA) — send received stock back to a supplier. Decrements
   * each item's on-hand (guarded so it can't drive stock negative) and records
   * a SUPPLIER_RETURN movement. Serializable so a concurrent deduction can't
   * race the shortfall guard.
   */
  async createSupplierReturn(
    scope: BranchScope,
    userId: string,
    dto: {
      supplierId: string;
      reason?: string;
      items: Array<{
        stockItemId: string;
        quantity: number;
        unitCost?: number;
      }>;
    },
  ) {
    // Tenant-ownership on the supplier (mirrors create()) so a foreign/garbage
    // supplierId can't be stamped onto the movement ledger.
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, tenantId: scope.tenantId },
      select: { id: true },
    });
    if (!supplier) throw new BadRequestException("Supplier not found");

    return this.prisma.$transaction(
      async (tx) => {
        const returnedItems: Array<{ stockItemId: string; quantity: number }> =
          [];
        for (const item of dto.items) {
          const qty = D(item.quantity);
          const dec = await tx.stockItem.updateMany({
            where: {
              id: item.stockItemId,
              ...branchScope(scope),
              currentStock: { gte: qty as any },
            },
            data: { currentStock: { decrement: qty as any } },
          });
          if (dec.count === 0) {
            throw new ConflictException(
              "Insufficient stock to return this item",
            );
          }
          // Keep the FIFO batch ledger in sync (mirrors waste/deduction) so
          // batch valuation + FIFO-COGS don't retain a phantom returned layer.
          await drawDownBatchesFifo(
            tx,
            {
              stockItemId: item.stockItemId,
              tenantId: scope.tenantId,
              branchId: scope.branchId,
            },
            qty,
          );
          await tx.ingredientMovement.create({
            data: {
              type: "SUPPLIER_RETURN",
              quantity: qty.neg() as any,
              costPerUnit:
                item.unitCost != null ? (D(item.unitCost) as any) : undefined,
              notes: dto.reason ?? "Supplier return",
              referenceType: "SUPPLIER",
              referenceId: dto.supplierId,
              stockItemId: item.stockItemId,
              tenantId: scope.tenantId,
              branchId: scope.branchId,
              createdById: userId,
            },
          });
          returnedItems.push({
            stockItemId: item.stockItemId,
            quantity: qty.toNumber(),
          });
        }
        return { supplierId: dto.supplierId, returnedItems };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async markPaid(scope: BranchScope, invoiceId: string) {
    const claim = await this.prisma.purchaseInvoice.updateMany({
      where: { id: invoiceId, ...branchScope(scope), status: "APPROVED" },
      data: { status: "PAID" },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        "Invoice must be APPROVED before it can be marked paid",
      );
    }
    return this.prisma.purchaseInvoice.findFirst({
      where: { id: invoiceId, ...branchScope(scope) },
    });
  }
}
